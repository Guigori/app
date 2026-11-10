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
        _, closing = cycle_bounds(today, card["closing_day"])
        due = due_date(closing, card["closing_day"], card["due_day"])
        days_left = due.toordinal() - today.toordinal()
        if due.toordinal() > limit:
            continue
        notification_id = f"card-{card['id']}-{due.isoformat()}"
        if notification_id in dismissed:
            continue
        items.append(
            NotificationItem(
                id=notification_id,
                kind="fatura",
                title=f"Fatura {card['name']}",
                description=f"Fecha em {closing.strftime('%d/%m')} e vence em {due.strftime('%d/%m')}.",
                date=due.isoformat(),
                value=D("0.0"),
                days_left=days_left,
                target_url=f"/cartoes/{card['id']}?due={due.isoformat()}",
            )
        )
    items = await _pending_items(user["id"], dismissed) + items
    items.sort(key=lambda item: (item.days_left, item.title))
    return NotificationsOut(items=items, count=len(items))


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
