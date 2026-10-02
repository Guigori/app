"""Demo data controls. Loading the demo REPLACES the user's financial records —
the substitution is explicit and confirmed in the UI."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from lib.db import db
from lib.demo_data import DEFAULT_CATEGORIES, insert_default_categories, load_demo_for_user
from routers.auth import require_user

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/load")
async def load_demo(user: dict = Depends(require_user)) -> dict:
    await load_demo_for_user(user["id"])
    return {"ok": True, "message": "Dados de demonstração carregados."}


@router.post("/clear")
async def clear_data(user: dict = Depends(require_user)) -> dict:
    for collection in ("transactions", "accounts", "categories", "cards"):
        await db[collection].delete_many({"user_id": user["id"]})
    await insert_default_categories(user["id"])
    return {"ok": True, "message": "Dados removidos. Sua conta está pronta para uso real."}
