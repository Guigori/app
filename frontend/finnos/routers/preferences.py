"""App preferences that follow the user between devices (no financial data).

Stored as one document per user outside the finance collections, so saving a
preference never bumps the finance revision. Only known keys are accepted.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.routers.auth import require_user

router = APIRouter(prefix="/preferences", tags=["preferences"])

ALLOWED = {"navigation", "home", "register_default"}
MAX_VALUE = 4000


class PreferencesIn(BaseModel):
    values: dict[str, str] = Field(default_factory=dict)


def _doc(uid: str):
    return store.root(store.client(), uid).collection("app_preferences").document("app")


@router.get("")
async def read_preferences(user=Depends(require_user)):
    snap = await run_in_threadpool(lambda: _doc(user["id"]).get())
    data = snap.to_dict() if snap.exists else {}
    return {"values": data.get("values", {}), "updated_at": data.get("updated_at")}


@router.put("")
async def save_preferences(payload: PreferencesIn, user=Depends(require_user)):
    unknown = set(payload.values) - ALLOWED
    if unknown:
        raise HTTPException(422, "Preferência desconhecida.")
    if any(len(v) > MAX_VALUE for v in payload.values.values()):
        raise HTTPException(422, "Preferência grande demais.")
    data = {"values": payload.values, "updated_at": datetime.now(timezone.utc).isoformat()}
    await run_in_threadpool(lambda: _doc(user["id"]).set(data, merge=True))
    return data
