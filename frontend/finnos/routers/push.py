"""Notification preferences for the active Firebase API.

Preferences persist per verified user. Web Push transport is deliberately not
advertised until a VAPID dispatcher and device registry are deployed.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from finnos.lib.db import db
from finnos.models.notify import NotifyPrefsIn, NotifyPrefsOut
from finnos.routers.auth import require_user


router = APIRouter(prefix="/push", tags=["push"])


def _output(doc: dict | None = None) -> NotifyPrefsOut:
    defaults = NotifyPrefsIn().model_dump()
    for key in defaults:
        if doc is not None and key in doc:
            defaults[key] = doc[key]
    return NotifyPrefsOut(**defaults, push_devices=0, push_supported=False)


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


@router.get("/public-key")
async def push_public_key(user: dict = Depends(require_user)):
    return {"public_key": "", "supported": False}


@router.post("/subscribe")
async def subscribe_push(user: dict = Depends(require_user)):
    raise HTTPException(503, "Push remoto ainda não foi habilitado. Nenhum aparelho foi registrado.")


@router.delete("/subscribe")
async def unsubscribe_push(user: dict = Depends(require_user)):
    raise HTTPException(503, "Push remoto ainda não foi habilitado.")


@router.post("/test")
async def send_test_push(user: dict = Depends(require_user)):
    raise HTTPException(503, "Push remoto ainda não foi habilitado. Use avisos locais no modo local.")
