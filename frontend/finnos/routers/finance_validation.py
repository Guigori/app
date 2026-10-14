"""Authenticated, read-only Firestore finance validation endpoint."""
from fastapi import APIRouter, Depends
from finnos.lib.db import db
from finnos.lib.finance_audit import KINDS, audit_finance
from finnos.routers.auth import require_user

router = APIRouter(prefix="/finance", tags=["finance-validation"])


@router.get("/integrity")
async def validation(user: dict = Depends(require_user)):
    uid = user["id"]
    records = {}
    for kind in KINDS:
        records[kind] = await getattr(db, kind).find({"user_id": uid}).to_list(20000)
    return audit_finance(records)
