"""Platform cron endpoints. The scheduler only reads the status line, so these ack
immediately and do the real work in a background task."""

import logging
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from lib.db import db
from lib.email import due_reminder_html, send_email
from lib.push import send_push_to_user

load_dotenv()
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cron", tags=["cron"])

CRON_SECRET = os.environ.get("WEBHOOK_CRON_SECRET", "")
ZONE = ZoneInfo("America/Sao_Paulo")
DEFAULTS = {"push_enabled": True, "email_enabled": False, "hour": 9, "days_before": 1}


def _authorize(authorization: str | None) -> None:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not CRON_SECRET or not token or not secrets.compare_digest(token, CRON_SECRET):
        raise HTTPException(status_code=401, detail="Não autorizado.")


async def _run_reminders(run_id: str, force_user_id: str | None = None) -> None:
    """Warn each user about money due `days_before` days from now, at their chosen hour."""
    now = datetime.now(ZONE)
    users = await db.users.find({}).to_list(5000)
    for user in users:
        doc = await db.notify_prefs.find_one({"user_id": user["id"]}) or {}
        prefs = {**DEFAULTS, **{k: doc[k] for k in DEFAULTS if k in doc}}
        if force_user_id:
            if user["id"] != force_user_id:
                continue
        elif int(prefs["hour"]) != now.hour:
            continue
        if not prefs["push_enabled"] and not prefs["email_enabled"]:
            continue

        target = (now.date() + timedelta(days=int(prefs["days_before"]))).isoformat()
        txs = await db.transactions.find(
            {"user_id": user["id"], "status": {"$in": ["agendado", "pendente"]}, "date": target}
        ).to_list(200)
        cards = await db.cards.find({"user_id": user["id"], "active": True}).to_list(100)

        items: list[tuple[str, str, float]] = [(t["id"], t["name"], float(t["value"])) for t in txs]
        for card in cards:
            from lib.cards import cycle_bounds, due_date  # local import avoids a cycle

            _, closing = cycle_bounds(now.date(), card["closing_day"])
            due = due_date(closing, card["closing_day"], card["due_day"])
            if due.isoformat() == target:
                items.append((f"card-{card['id']}", f"Fatura {card['name']}", 0.0))
        if not items:
            continue

        fresh = []
        for item_id, name, value in items:
            key = f"{user['id']}:{item_id}:{target}"
            existing = await db.reminder_log.find_one({"key": key})
            if existing:
                continue
            await db.reminder_log.insert_one(
                {"key": key, "user_id": user["id"], "run_id": run_id, "sent_at": datetime.now(timezone.utc)}
            )
            fresh.append((name, value))
        if not fresh:
            continue

        when = "amanhã" if int(prefs["days_before"]) == 1 else f"em {prefs['days_before']} dia(s)"
        if int(prefs["days_before"]) == 0:
            when = "hoje"
        headline = fresh[0][0] if len(fresh) == 1 else f"{len(fresh)} lançamentos"
        body = f"{headline} vence {when} ({date.fromisoformat(target).strftime('%d/%m')})."

        if prefs["push_enabled"]:
            await send_push_to_user(user["id"], title="FINNOS · vencimento", body=body, url="/transacoes", tag="finnos-vencimento")
        if prefs["email_enabled"] and user.get("email"):
            try:
                await send_email(
                    to=user["email"],
                    subject="FINNOS: contas chegando no vencimento",
                    html=due_reminder_html(name=user.get("name", "você"), when=when, date_label=date.fromisoformat(target).strftime("%d/%m/%Y"), items=fresh),
                )
            except Exception as exc:  # noqa: BLE001 — a failed e-mail must not stop the run
                logger.warning("reminder e-mail failed: %s", type(exc).__name__)


@router.post("/reminders")
async def reminders(
    request: Request,
    background: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_webhook_id: str | None = Header(default=None),
) -> dict:
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _authorize(authorization)
    try:
        envelope = await request.json()
    except Exception:  # noqa: BLE001
        envelope = {}
    run_id = x_webhook_id or envelope.get("run_id") or datetime.now(timezone.utc).isoformat()
    background.add_task(_run_reminders, run_id)
    return {"accepted": True, "run_id": run_id}
