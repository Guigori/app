"""Push subscriptions + reminder preferences (one document per user)."""

import os

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Response

from lib.db import db
from lib.cards import cycle_bounds, due_date
from lib.dates import today_iso
from lib.push import VAPID_PUBLIC_KEY, push_configured, send_push_to_user
from models.notify import NotifyPrefsIn, NotifyPrefsOut, PushSubscriptionIn
from routers.auth import require_user
from routers.radar import _signals as radar_signals

router = APIRouter(prefix="/push", tags=["push"])
CRON_SECRET = os.environ.get("CRON_SECRET", "")

DEFAULT_PREFS = {
    "push_enabled": True,
    "email_enabled": False,
    "hour": 9,
    "days_before": 1,
    "transaction_reminders": True,
    "invoice_reminders": True,
    "radar_alerts": True,
    "activity_reminders": True,
    "weekly_summary": True,
    "system_notices": True,
}


async def prefs_for(user_id: str) -> dict:
    doc = await db.notify_prefs.find_one({"user_id": user_id}) or {}
    return {**DEFAULT_PREFS, **{k: doc[k] for k in DEFAULT_PREFS if k in doc}}


@router.get("/public-key")
async def public_key() -> dict:
    """Safe to expose: this is the VAPID public key, never the private one."""
    return {"public_key": VAPID_PUBLIC_KEY, "supported": push_configured()}


@router.post("/subscribe", status_code=204, response_class=Response)
async def subscribe(payload: PushSubscriptionIn, user: dict = Depends(require_user)) -> Response:
    now = datetime.now(timezone.utc)
    await db.push_subscriptions.update_one(
        {"endpoint": payload.endpoint},
        {
            "$set": {"user_id": user["id"], "keys": payload.keys.model_dump(), "updated_at": now},
            "$setOnInsert": {"endpoint": payload.endpoint, "created_at": now},
        },
        upsert=True,
    )
    return Response(status_code=204)


@router.delete("/subscribe", status_code=204, response_class=Response)
async def unsubscribe(endpoint: str, user: dict = Depends(require_user)) -> Response:
    await db.push_subscriptions.delete_one({"endpoint": endpoint, "user_id": user["id"]})
    return Response(status_code=204)


@router.get("/prefs", response_model=NotifyPrefsOut)
async def get_prefs(user: dict = Depends(require_user)) -> NotifyPrefsOut:
    prefs = await prefs_for(user["id"])
    devices = await db.push_subscriptions.count_documents({"user_id": user["id"]})
    return NotifyPrefsOut(**prefs, push_devices=devices, push_supported=push_configured())


@router.put("/prefs", response_model=NotifyPrefsOut)
async def set_prefs(payload: NotifyPrefsIn, user: dict = Depends(require_user)) -> NotifyPrefsOut:
    await db.notify_prefs.update_one(
        {"user_id": user["id"]},
        {"$set": {**payload.model_dump(), "user_id": user["id"], "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    devices = await db.push_subscriptions.count_documents({"user_id": user["id"]})
    return NotifyPrefsOut(**payload.model_dump(), push_devices=devices, push_supported=push_configured())


@router.post("/test")
async def send_test(user: dict = Depends(require_user)) -> dict:
    """Lets the user confirm the permission actually works on this device."""
    sent = await send_push_to_user(
        user["id"],
        title="FINNOS",
        body="Pronto! Os avisos de vencimento vão chegar assim neste aparelho.",
        url="/transacoes",
        tag="finnos-teste",
    )
    return {"sent": sent}


async def _send_once(user_id: str, key: str, *, title: str, body: str, url: str) -> int:
    day = today_iso()
    delivery_id = f"{user_id}:{day}:{key}"
    if await db.push_delivery_log.find_one({"id": delivery_id}):
        return 0
    sent = await send_push_to_user(user_id, title=title, body=body, url=url, tag=key)
    if sent:
        await db.push_delivery_log.insert_one(
            {"id": delivery_id, "user_id": user_id, "key": key, "day": day, "created_at": datetime.now(timezone.utc)}
        )
    return sent


@router.post("/dispatch")
async def dispatch_scheduled_notifications(
    x_cron_secret: str | None = Header(default=None),
) -> dict:
    """Hourly scheduler entrypoint. Sends each eligible FINNOS push at most once per day."""
    if not CRON_SECRET or x_cron_secret != CRON_SECRET:
        raise HTTPException(status_code=401, detail="Scheduler não autorizado.")

    now_local = datetime.now(ZoneInfo("America/Sao_Paulo"))
    today = date.fromisoformat(today_iso())
    user_ids = await db.push_subscriptions.distinct("user_id")
    users_checked = 0
    pushes_sent = 0

    for user_id in user_ids:
        prefs = await prefs_for(user_id)
        if not prefs.get("push_enabled", True):
            continue
        if int(prefs.get("hour", 9)) != now_local.hour:
            continue
        users_checked += 1
        days_before = int(prefs.get("days_before", 1))
        end = (today + timedelta(days=days_before)).isoformat()

        txs = await db.transactions.find(
            {
                "user_id": user_id,
                "status": {"$in": ["agendado", "pendente"]},
                "date": {"$gte": today.isoformat(), "$lte": end},
                "notify_enabled": {"$ne": False},
            }
        ).to_list(500)
        if not prefs.get("transaction_reminders", True):
            txs = []
        for tx in txs:
            due = date.fromisoformat(tx["date"])
            left = (due - today).days
            when = "vence hoje" if left == 0 else f"vence em {left} dia(s)"
            word = "Receita" if tx["type"] == "receita" else "Conta" if tx["type"] == "despesa" else "Transferência"
            pushes_sent += await _send_once(
                user_id,
                f"tx-{tx['id']}-{tx['date']}",
                title=f"{word}: {tx['name']}",
                body=f"{when.capitalize()} · R$ {float(tx['value']):,.2f}".replace(",", "X").replace(".", ",").replace("X", "."),
                url=f"/transacoes?date={tx['date']}&highlight={tx['id']}",
            )

        cards = (
            await db.cards.find({"user_id": user_id, "active": True}).to_list(200)
            if prefs.get("invoice_reminders", True)
            else []
        )
        for card in cards:
            _, closing = cycle_bounds(today, card["closing_day"])
            due = due_date(closing, card["closing_day"], card["due_day"])
            left = (due - today).days
            if 0 <= left <= days_before:
                pushes_sent += await _send_once(
                    user_id,
                    f"card-{card['id']}-{due.isoformat()}",
                    title=f"Fatura {card['name']}",
                    body="Vence hoje." if left == 0 else f"Vence em {left} dia(s).",
                    url=f"/cartoes/{card['id']}?due={due.isoformat()}",
                )

        for signal in ((await radar_signals(user_id))[:10] if prefs.get("radar_alerts", True) else []):
            if signal.get("severity") not in ("high", "critical"):
                continue
            pushes_sent += await _send_once(
                user_id,
                f"radar-{signal['id']}",
                title=f"Radar FINNOS · {signal['title']}",
                body=signal["description"],
                url=f"/radar/{signal['id']}",
            )

        today_count = await db.transactions.count_documents({"user_id": user_id, "date": today.isoformat()})
        total_count = await db.transactions.count_documents({"user_id": user_id})
        if prefs.get("activity_reminders", True) and total_count > 0 and today_count == 0:
            pushes_sent += await _send_once(
                user_id,
                "registro-diario",
                title="FINNOS",
                body="Nenhuma movimentação registrada hoje. Quer atualizar seus gastos?",
                url="/transacoes",
            )

        if prefs.get("weekly_summary", True) and today.weekday() == 0:
            week_start = (today - timedelta(days=7)).isoformat()
            week_txs = await db.transactions.find(
                {"user_id": user_id, "date": {"$gte": week_start, "$lt": today.isoformat()}, "status": "pago"}
            ).to_list(5000)
            expenses = sum(float(tx.get("value") or 0) for tx in week_txs if tx.get("type") == "despesa")
            count = len(week_txs)
            if count == 0:
                body = "Sua semana terminou sem movimentações registradas."
            else:
                formatted = f"{expenses:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
                body = f"{count} lançamento(s) na última semana · R$ {formatted} em despesas."
            pushes_sent += await _send_once(
                user_id,
                "resumo-semanal",
                title="Resumo semanal FINNOS",
                body=body,
                url="/",
            )

    return {"ok": True, "users_checked": users_checked, "pushes_sent": pushes_sent}
