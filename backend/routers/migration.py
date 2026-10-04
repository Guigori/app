"""Safe one-time import of browser-local FINNOS data after account creation."""

from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.db import db
from routers.auth import require_user

router = APIRouter(prefix="/migration", tags=["migration"])

class LocalImportIn(BaseModel):
    import_id: str = Field(min_length=8, max_length=100)
    accounts: list[dict[str, Any]] = Field(max_length=200)
    categories: list[dict[str, Any]] = Field(max_length=500)
    transactions: list[dict[str, Any]] = Field(max_length=20000)
    cards: list[dict[str, Any]] = Field(default_factory=list, max_length=200)

@router.post("/local")
async def import_local(payload: LocalImportIn, user: dict = Depends(require_user)) -> dict:
    uid = user["id"]
    previous = await db.local_imports.find_one({"user_id": uid, "import_id": payload.import_id})
    if previous:
        return {"ok": True, "already_imported": True}

    # This endpoint is intentionally onboarding-only: never overwrite an account
    # that already contains real financial records.
    if await db.accounts.count_documents({"user_id": uid}) or await db.transactions.count_documents({"user_id": uid}):
        raise HTTPException(status_code=409, detail="Esta conta já possui dados. A importação local não foi aplicada para evitar sobrescrever informações.")

    def clean(doc: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in doc.items() if k not in {"_id", "user_id"}}
        out["user_id"] = uid
        out.setdefault("id", str(uuid.uuid4()))
        return out

    # Verification creates default categories. Replace only those defaults with
    # the browser categories so transaction/category ids remain consistent.
    await db.categories.delete_many({"user_id": uid})
    collections = {
        "categories": payload.categories,
        "accounts": payload.accounts,
        "cards": payload.cards,
        "transactions": payload.transactions,
    }
    for name, rows in collections.items():
        if rows:
            await db[name].insert_many([clean(row) for row in rows])

    await db.local_imports.insert_one({"user_id": uid, "import_id": payload.import_id})
    return {
        "ok": True,
        "already_imported": False,
        "imported": {name: len(rows) for name, rows in collections.items()},
    }
