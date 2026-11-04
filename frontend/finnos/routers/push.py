"""Notification preferences for the active Firebase API.

Preferences persist per verified user. Web Push transport is deliberately not
advertised until a VAPID dispatcher and device registry are deployed.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from hashlib import sha256
import os
import json

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from starlette.concurrency import run_in_threadpool
from finnos.lib import db as store
from finnos.lib.push_transport import ready, gateway, registration_id, require_cron_secret, send
from finnos.models.notify import PushSubscriptionIn

from finnos.lib.db import db
from finnos.models.notify import NotifyPrefsIn, NotifyPrefsOut
from finnos.routers.auth import require_user


router = APIRouter(prefix="/push", tags=["push"])


def _output(doc: dict | None = None) -> NotifyPrefsOut:
    defaults = NotifyPrefsIn().model_dump()
    for key in defaults:
        if doc is not None and key in doc:
            defaults[key] = doc[key]
    return NotifyPrefsOut(**defaults, push_devices=0, push_supported=ready())


@router.get("/prefs", response_model=NotifyPrefsOut)
async def get_preferences(user: dict = Depends(require_user)):
    saved = await db.notification_preferences.find_one({"user_id": user["id"], "id": "prefs"})
    return _output(saved)


@router.put("/prefs", response_model=NotifyPrefsOut)
async def save_preferences(input: NotifyPrefsIn, user: dict = Depends(require_user)):
    uid = user["id"]
    patch = input.model_dump()
    saved = await db.notification_preferences.find_one({"user_id": uid, "id": "prefs"})
    now = datetime.now(timezone.utc)
    if saved:
        await db.notification_preferences.update_one(
            {"user_id": uid, "id": "prefs"},
            {"$set": {**patch, "updated_at": now}},
        )
    else:
        try:
            await db.notification_preferences.insert_one({
                "id": "prefs", "user_id": uid, **patch,
                "created_at": now, "updated_at": now,
            })
        except HTTPException as exc:
            if exc.status_code != 409:
                raise
            await db.notification_preferences.update_one(
                {"user_id": uid, "id": "prefs"}, {"$set": {**patch, "updated_at": now}}
            )
    return _output(patch)


def _registration_collection():
    # Service-account-only global index of explicitly opted-in endpoints.
    # Firestore clients never receive this collection or its credentials.
    return store.client().collection("finnos_push_registrations")


@router.get("/public-key")
async def push_public_key(user: dict = Depends(require_user)):
    return {
        "public_key": os.environ.get("VAPID_PUBLIC_KEY", "") if ready() else "",
        "supported": ready(),
    }


@router.post("/subscribe")
async def subscribe_push(
    payload: PushSubscriptionIn,
    user: dict = Depends(require_user),
):
    if not ready():
        raise HTTPException(503, "Push remoto não configurado.")
    gateway(payload.endpoint)
    uid = user["id"]
    key = registration_id(uid, payload.endpoint)
    info = payload.model_dump()
    def register():
        collection = _registration_collection()
        # An explicit overwrite is idempotent for the same Firebase UID.
        collection.document(key).set({
            "uid": uid,
            "subscription": info,
            "registered_at": datetime.now(timezone.utc).isoformat(),
            "enabled": True,
        })
    await run_in_threadpool(register)
    return {"ok": True, "pending": False}


@router.delete("/subscribe")
async def unsubscribe_push(
    endpoint: str = Query(..., min_length=10, max_length=600),
    user: dict = Depends(require_user),
):
    gateway(endpoint)
    uid = user["id"]
    key = registration_id(uid, endpoint)
    await run_in_threadpool(
        lambda: _registration_collection().document(key).delete()
    )
    return {"ok": True}


@router.post("/test")
async def send_test_push(user: dict = Depends(require_user)):
    if not ready():
        raise HTTPException(503, "Push remoto não configurado.")
    uid = user["id"]

    def send_test():
        # Registration is stored globally but scoped to verified UID here.
        docs = list(_registration_collection().where("uid", "==", uid)
                    .limit(10).stream(timeout=15))
        count = 0
        for item in docs:
            info = (item.to_dict() or {}).get("subscription")
            if info:
                send(info, {
                    "title": "FINNOS · Teste",
                    "body": "Seu dispositivo recebeu uma notificação de teste.",
                    "url": "/notificacoes",
                })
                count += 1
        return count

    count = await run_in_threadpool(send_test)
    return {"sent": count}


def _dispatch_window(prefs: dict, hour: int) -> int | None:
    """Only send during the hour explicitly chosen by this user (São Paulo time).

    A zero-day preference means due today, plus overdue items already surfaced
    by the notification engine. No default-hour send at every cron execution.
    """
    if not prefs.get("push_enabled", True):
        return None
    if int(prefs.get("hour", 9)) != hour:
        return None
    return max(0, min(7, int(prefs.get("days_before", 1))))


def _dispatch_kind_allowed(kind: str, prefs: dict) -> bool:
    if kind == "fatura":
        return bool(prefs.get("invoice_reminders", True))
    return bool(prefs.get("transaction_reminders", True))


@router.get("/dispatch")
async def dispatch_push(
    authorization: str | None = Header(default=None),
):
    """Daily, admin-only, bounded dispatcher.

    No production Cron is installed automatically: vercel.json keeps
    'crons': [] until an explicit production release is approved.
    """
    require_cron_secret(authorization)
    if not ready():
        raise HTTPException(503, "Push agendado ainda não configurado.")

    from finnos.routers.notifications import notifications
    from finnos.lib.db import active_uid
    from finnos.lib.dates import today_iso

    def registrations():
        # A bounded batch prevents unexpectedly unbounded cost/time.
        snaps = list(_registration_collection().limit(101).stream(timeout=15))
        if len(snaps) > 100:
            raise HTTPException(503, "Mais de 100 aparelhos. Paginação de dispatcher necessária.")
        return [doc.to_dict() or {} for doc in snaps]

    registrations_list = await run_in_threadpool(registrations)
    local_hour = datetime.now(ZoneInfo("America/Sao_Paulo")).hour
    sent = 0
    failures = 0
    # A prior notification delivery can be acknowledged by the push gateway
    # even if the function crashes. Claims are therefore saved BEFORE sending:
    # this is at-most-once dispatch for each UID + notification/day.
    for registration in registrations_list:
        uid = registration.get("uid")
        subscription = registration.get("subscription")
        if not uid or not subscription or not registration.get("enabled"):
            continue
        token = active_uid.set(uid)
        try:
            prefs = await db.notification_preferences.find_one({
                "user_id": uid, "id": "prefs",
            })
            settings = {**NotifyPrefsIn().model_dump(), **(prefs or {})}
            window = _dispatch_window(settings, local_hour)
            if window is None:
                continue
            reminder = await notifications(window_days=window, user={"id": uid})
            for item in reminder.items[:25]:
                if not _dispatch_kind_allowed(item.kind, settings):
                    continue
                fingerprint = sha256(
                    (uid + "\0" + subscription["endpoint"] + "\0"
                     + item.id + "\0" + today_iso()).encode()
                ).hexdigest()
                ref = store.client().collection("finnos_push_dispatch_receipts").document(fingerprint)

                def claim():
                    from google.api_core.exceptions import AlreadyExists
                    try:
                        ref.create({
                            "uid": uid, "notification_id": item.id,
                            "date": today_iso(), "state": "claimed",
                        })
                        return True
                    except AlreadyExists:
                        return False
                claimed = await run_in_threadpool(claim)
                if not claimed:
                    continue
                try:
                    await run_in_threadpool(send, subscription, {
                        "title": item.title,
                        "body": item.description,
                        "url": item.target_url,
                    })
                    await run_in_threadpool(lambda: ref.update({"state": "sent"}))
                    sent += 1
                except Exception:
                    failures += 1
                    await run_in_threadpool(lambda: ref.update({"state": "failed"}))
                    # Never disclose tokens or endpoints via logs/response.
        finally:
            active_uid.reset(token)
    return {"sent": sent, "failed": failures, "processed_devices": len(registrations_list)}
