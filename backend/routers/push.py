"""Push subscriptions + reminder preferences (one document per user)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response

from lib.db import db
from lib.push import VAPID_PUBLIC_KEY, push_configured, send_push_to_user
from models.notify import NotifyPrefsIn, NotifyPrefsOut, PushSubscriptionIn
from routers.auth import require_user

router = APIRouter(prefix="/push", tags=["push"])

DEFAULT_PREFS = {"push_enabled": True, "email_enabled": False, "hour": 9, "days_before": 1}


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
