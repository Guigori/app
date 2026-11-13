from finnos.lib.money import D

"""Notifications: scheduled/pending money coming due, and card invoices closing in."""
import logging
from datetime import date
from fastapi import APIRouter, Depends, Query
from starlette.concurrency import run_in_threadpool
from finnos.lib import pending_captures as pending
from finnos.lib.cards import cycle_bounds, due_date
from finnos.lib.db import db
from finnos.lib.dates import today_iso
from finnos.models.cards import NotificationItem, NotificationsOut
from finnos.routers.auth import require_user

router = APIRouter(prefix="/notifications", tags=["notifications"])
TYPE_WORD = {"receita": "Receita", "despesa": "Conta", "transferencia": "Transferência"}


async def _pending_items(uid: str, dismissed: set) -> list[NotificationItem]:
    """Purchases captured by Apple Pay that still wait for "registrar" or "excluir"."""
    # Imported here: the router module needs the wallets helper, which imports this package.
    from finnos.routers.pending_captures import present

    try:
        rows = await run_in_threadpool(pending.list_all, uid)
        captured = await present(uid, rows)
    except Exception:  # a hiccup here must not hide the due dates and invoices below
        logging.getLogger(__name__).warning("pending captures unavailable for notifications", exc_info=True)
        return []
    return [
        NotificationItem(
            id=f"capture-{item['id']}",
            kind="captura",
            title=f"Compra pendente: {item['name']}",
            description=f"{item['origin']}. " + (f"Pendente há {item['waiting_days']} dias. " if item["stale"] else "") + "Confirme ou exclua.",
            date=item["date"],
            value=round(D(item["value"]), 2),
            # Not shown: only keeps these first in the list, ahead of anything overdue.
            days_left=-9999,
            target_url="/",
        )
        for item in captured
        if f"capture-{item['id']}" not in dismissed
    ]


@router.get("", response_model=NotificationsOut)
async def notifications(
    window_days: int = Query(default=7, ge=1, le=60), user: dict = Depends(require_user)
) -> NotificationsOut:
    """Everything that needs attention: overdue entries and anything due within the window."""
    today = date.fromisoformat(today_iso())
    limit = today.toordinal() + window_days
    txs = await db.transactions.find(
        {"user_id": user["id"], "status": {"$in": ["agendado", "pendente"]}}
    ).to_list(5000)
    dismissed_docs = await db.notification_states.find(
        {"user_id": user["id"], "dismissed": True}
    ).to_list(5000)
    dismissed = {doc["notification_id"] for doc in dismissed_docs}
    items: list[NotificationItem] = []
    for tx in txs:
        if tx.get("notify_enabled", True) is False:
            continue
        due = date.fromisoformat(tx["date"])
        days_left = due.toordinal() - today.toordinal()
        if days_left > window_days:
            continue
        overdue = days_left < 0
        word = TYPE_WORD.get(tx["type"], "Lançamento")
        if overdue:
            description = f"Venceu há {abs(days_left)} dia(s) e continua em aberto."
        elif days_left == 0:
            description = "Vence hoje."
        else:
            description = f"Vence em {days_left} dia(s)."
        notification_id = f"tx-{tx['id']}-{tx['date']}"
        if notification_id in dismissed:
            continue
        items.append(
            NotificationItem(
                id=notification_id,
                kind="atrasado" if overdue else "vencimento",
                title=f"{word}: {tx['name']}",
                description=description,
                date=tx["date"],
                value=round(D(tx["value"]), 2),
                days_left=days_left,
                target_url=f"/transacoes?date={tx['date']}&highlight={tx['id']}",
            )
        )
    cards = await db.cards.find({"user_id": user["id"], "active": True}).to_list(200)
    for card in cards:
        if card.get("invoice_reminder", True) is False:
            continue  # the person turned the invoice reminder off for this card
        days = card.get("remind_days")
        card_limit = today.toordinal() + days if days else limit
        items.extend(await _invoice_reminders(user["id"], card, today, card_limit, dismissed))
    items.extend(await _limit_alerts(user["id"], [c for c in cards if c.get("limit_alert")], today, dismissed))
    items.extend(await _low_balance_alerts(user["id"], today, dismissed))
    items = await _pending_items(user["id"], dismissed) + items
    items.sort(key=lambda item: (item.days_left, item.title))
    return NotificationsOut(items=items, count=len(items))


async def _limit_alerts(uid: str, cards: list[dict], today, dismissed: set) -> list[NotificationItem]:
    """Carteira (etapa 6): cards with the 80% alert on and at least 80% of the limit in use."""
    if not cards:
        return []
    from finnos.routers.cards import _build, _context_all_cards, _institutions

    by_card, accounts = await _context_all_cards(uid, cards)
    institutions = await _institutions(uid)
    found = []
    for doc in cards:
        out = await _build(doc, by_card[doc["id"]], accounts, institutions)
        if out.used_percent < 80:
            continue
        notification_id = f"limit-{doc['id']}-{out.next_closing}"
        if notification_id in dismissed:
            continue
        found.append(NotificationItem(
            id=notification_id, kind="fatura", title=f"{doc['name']}: {int(out.used_percent)}% do limite",
            description="O limite está quase no fim. Confira a fatura antes de novas compras.",
            date=today.isoformat(), value=out.available, days_left=0, target_url=f"/cartoes/{doc['id']}",
        ))
    return found


async def _low_balance_alerts(uid: str, today, dismissed: set) -> list[NotificationItem]:
    """Carteira (etapa 6): accounts whose balance is below the alert the person set.
    One per account and day, so dismissing it lasts until tomorrow."""
    from finnos.routers.accounts import _enriched_accounts

    found = []
    enriched = await _enriched_accounts(uid)
    for account in enriched:
        if account.type == "beneficio" and account.active:
            for wallet in account.wallets:
                if account.benefit_runout_alert and wallet.runs_out_on and wallet.next_recharge:
                    nid = f"runout-{account.id}-{wallet.id}-{wallet.next_recharge}"
                    if nid not in dismissed:
                        found.append(NotificationItem(
                            id=nid, kind="saldo", title=f"{wallet.name} pode acabar antes da recarga",
                            description=f"No ritmo atual acaba por volta de {wallet.runs_out_on[8:10]}/{wallet.runs_out_on[5:7]}; a recarga cai em {wallet.next_recharge[8:10]}/{wallet.next_recharge[5:7]}.",
                            date=today.isoformat(), value=wallet.balance, days_left=0, target_url=f"/contas/beneficio/{account.id}?b={wallet.id}"))
        threshold = account.low_balance_alert
        if not account.active or not threshold or account.balance >= threshold:
            continue
        notification_id = f"low-{account.id}-{today.isoformat()}"
        if notification_id in dismissed:
            continue
        found.append(NotificationItem(
            id=notification_id, kind="saldo", title=f"Saldo baixo em {account.name}",
            description=f"Ficou abaixo de R$ {D(threshold):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + ".",
            date=today.isoformat(), value=account.balance, days_left=0, target_url="/contas",
        ))
    recharged = [a for a in enriched if a.type == "beneficio" and a.active and a.benefit_recharge_alert]
    for account in recharged:
        docs = await db.transactions.find({"user_id": uid, "account_id": account.id, "date": today.isoformat()}).to_list(50)
        for tx in docs:
            if not tx.get("benefit_recharge"):
                continue
            nid = f"recharge-{tx['id']}"
            if nid in dismissed:
                continue
            found.append(NotificationItem(
                id=nid, kind="saldo", title=f"{tx['name']} caiu", description=f"A recarga de {account.name} entrou hoje.",
                date=today.isoformat(), value=D(tx["value"]), days_left=0, target_url=f"/contas/beneficio/{account.id}?b={tx.get('wallet_id') or ''}"))
    return found


async def _invoice_reminders(uid: str, card: dict, today, limit: int, dismissed: set) -> list[NotificationItem]:
    """Reminder only (approved 12/11/2026): one item per invoice with money still
    owed, due inside the window or already overdue. Paying is always a
    confirmation by the person; nothing is registered here."""
    from datetime import timedelta
    from finnos.lib.invoices import invoice_state

    start, current = cycle_bounds(today, card["closing_day"])
    _, previous = cycle_bounds(start - timedelta(days=1), card["closing_day"])
    purchases = await db.transactions.find({"user_id": uid, "card_id": card["id"]}).to_list(20000)
    found: list[NotificationItem] = []
    for closing in (previous, current):
        due = due_date(closing, card["closing_day"], card["due_day"])
        days_left = due.toordinal() - today.toordinal()
        if due.toordinal() > limit or days_left < -30:
            continue
        try:
            state = invoice_state(card, purchases, closing.isoformat())
        except (KeyError, ValueError):
            continue  # a malformed card must not hide the other reminders
        owed = state["total_cents"] - state["paid_cents"] - state.get("carried_cents", 0)
        if owed <= 0 and closing < today:
            continue  # closed and settled: nothing to remind
        notification_id = f"card-{card['id']}-{due.isoformat()}"
        if notification_id in dismissed:
            continue
        overdue = days_left < 0
        closed = closing < today
        description = (
            f"Venceu em {due.strftime('%d/%m')}. Pague e confirme no FINNOS." if overdue
            else f"Vence em {due.strftime('%d/%m')}. Confirme no FINNOS quando pagar." if closed
            else f"Fecha em {closing.strftime('%d/%m')} e vence em {due.strftime('%d/%m')}."
        )
        found.append(NotificationItem(
            id=notification_id,
            kind="fatura",
            title=f"Fatura {card['name']}" + (" atrasada" if overdue else ""),
            description=description,
            date=due.isoformat(),
            value=D(max(owed, 0)) / 100,
            days_left=days_left,
            target_url=f"/cartoes/{card['id']}?cycle={closing.isoformat()}",
        ))
    return found


@router.post("/{notification_id}/dismiss")
async def dismiss_notification(
    notification_id: str, user: dict = Depends(require_user)
) -> dict:
    """Hide one notification from the user's central without changing the underlying financial record."""
    await db.notification_states.update_one(
        {"user_id": user["id"], "notification_id": notification_id},
        {"$set": {"dismissed": True}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/clear")
async def clear_notifications(
    payload: dict, user: dict = Depends(require_user)
) -> dict:
    """Dismiss the notification IDs currently visible in the central."""
    ids = [str(item) for item in payload.get("ids", []) if str(item).strip()]
    if ids:
        await db.notification_states.update_many(
            {"user_id": user["id"], "notification_id": {"$in": ids}},
            {"$set": {"dismissed": True}},
            upsert=False,
        )
        existing = {
            doc["notification_id"]
            for doc in await db.notification_states.find(
                {"user_id": user["id"], "notification_id": {"$in": ids}}
            ).to_list(len(ids))
        }
        missing = [
            {
                "user_id": user["id"],
                "notification_id": notification_id,
                "dismissed": True,
            }
            for notification_id in ids
            if notification_id not in existing
        ]
        if missing:
            await db.notification_states.insert_many(missing)
    return {"ok": True, "count": len(ids)}
