"""Authenticated, read-only Firestore finance validation endpoint."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool
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


@router.get("/history")
async def finance_history(
    limit: int = Query(default=50, ge=1, le=100),
    before: str | None = Query(default=None, max_length=40),
    user: dict = Depends(require_user),
):
    """Newest financial changes, scoped to Firebase UID, with cursor pagination.

    History is read-only. FINN's destructive SQL undo is deliberately not
    transferred to Firestore or applied to settled bank transactions.
    """
    from finnos.lib import db as store
    from firebase_admin import firestore

    if before:
        try:
            datetime.fromisoformat(before)
        except ValueError as exc:
            raise HTTPException(422, "Cursor de histórico inválido.") from exc

    uid = store.scoped({"user_id": user["id"]})

    def read():
        collection = store.root(store.client(), uid).collection("finance_history")
        query = collection.order_by(
            "created_at", direction=firestore.Query.DESCENDING
        )
        if before:
            query = query.where("created_at", "<", before)
        items = [
            {"id": snapshot.id, **snapshot.to_dict()}
            for snapshot in query.limit(limit + 1).stream(timeout=15)
        ]
        has_more = len(items) > limit
        items = items[:limit]
        return {
            "items": items,
            "next_cursor": items[-1]["created_at"] if has_more and items else None,
        }

    return await run_in_threadpool(read)
