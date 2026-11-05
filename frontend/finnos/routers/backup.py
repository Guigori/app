"""Complete, read-only backup of one user's FINNOS data (Fase 1: proteção dos dados).

The export is scoped to the verified Firebase UID and is consistent: the
financial revision is read before and after the collections, and a concurrent
write makes the request fail (409) instead of returning a mixed snapshot.
Nothing is truncated silently: the adapter raises above its read limit.
Secrets (AI provider keys) and internal sync receipts are never exported.
"""
import hashlib
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib.account_balances import finance_revision
from finnos.lib.db import db
from finnos.routers.auth import require_user

router = APIRouter(prefix="/finance", tags=["backup"])

BACKUP_FORMAT = "finnos-backup"
BACKUP_VERSION = 1
# Order matters for restore: every reference points to an earlier collection.
COLLECTIONS = (
    "institutions", "accounts", "categories", "cards", "subscriptions",
    "goals", "investments", "budget_cycles", "transactions", "notification_preferences",
)
READ_LIMIT = 20000


def checksum(collections: dict) -> str:
    """SHA-256 over the canonical JSON of the exported collections."""
    canonical = json.dumps(collections, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _clean(doc: dict) -> dict:
    # The owner is implied by the account that restores the file.
    return {key: value for key, value in doc.items() if key != "user_id"}


@router.get("/backup")
async def export_backup(user: dict = Depends(require_user)):
    uid = user["id"]
    before = await finance_revision(uid)
    collections = {}
    for name in COLLECTIONS:
        rows = await getattr(db, name).find({"user_id": uid}).to_list(READ_LIMIT)
        collections[name] = sorted((_clean(row) for row in rows), key=lambda row: str(row.get("id", "")))

    def onboarding_state():
        snap = store.root(store.client(), uid).collection("onboarding").document("state").get()
        return snap.to_dict() if snap.exists else None

    onboarding = await run_in_threadpool(onboarding_state)
    if await finance_revision(uid) != before:
        raise HTTPException(409, "Seus dados mudaram durante o backup. Tente novamente em alguns segundos.")
    return {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "finance_revision": before,
        "counts": {name: len(rows) for name, rows in collections.items()},
        "checksum_sha256": checksum(collections),
        "collections": collections,
        "onboarding": onboarding,
        "excluded": ["ai_keys", "sync_receipts", "finance_history"],
    }


# Restore only into an account that has no financial data yet, so a backup can
# never be merged into (or duplicate) existing records. Default categories are
# reused by name and their IDs remapped inside the restored documents.
RESTORE_MUST_BE_EMPTY = ("institutions", "accounts", "cards", "subscriptions", "goals", "investments", "budget_cycles", "transactions")


def _normalize(text: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", str(text)) if unicodedata.category(c) != "Mn").casefold().strip()


def _remap(value, ids: dict):
    if isinstance(value, str):
        return ids.get(value, value)
    if isinstance(value, list):
        return [_remap(item, ids) for item in value]
    if isinstance(value, dict):
        return {key: _remap(item, ids) for key, item in value.items()}
    return value


@router.post("/restore")
async def restore_backup(payload: dict, user: dict = Depends(require_user)):
    uid = user["id"]
    if payload.get("format") != BACKUP_FORMAT or payload.get("version") != BACKUP_VERSION:
        raise HTTPException(400, "Arquivo não é um backup do FINNOS compatível.")
    collections = payload.get("collections")
    if not isinstance(collections, dict) or any(not isinstance(collections.get(name, []), list) for name in COLLECTIONS):
        raise HTTPException(400, "Backup incompleto.")
    if payload.get("checksum_sha256") != checksum(collections):
        raise HTTPException(400, "O arquivo foi alterado ou está corrompido (checksum não confere).")
    for name in RESTORE_MUST_BE_EMPTY:
        if await getattr(db, name).find({"user_id": uid}).to_list(1):
            raise HTTPException(409, "Sua conta já tem dados. Restaure o backup em uma conta vazia.")

    existing_categories = await db.categories.find({"user_id": uid}).to_list(READ_LIMIT)
    by_name = {_normalize(c.get("name", "")): c["id"] for c in existing_categories}
    existing_ids = {c["id"] for c in existing_categories}
    ids: dict[str, str] = {}
    for category in collections.get("categories", []):
        match = by_name.get(_normalize(category.get("name", "")))
        if match and match != category.get("id"):
            ids[category["id"]] = match

    restored = {}
    for name in COLLECTIONS:
        count = 0
        for doc in collections.get(name, []):
            if name == "categories" and (doc.get("id") in ids or doc.get("id") in existing_ids):
                continue
            clean = _remap({k: v for k, v in doc.items() if k not in {"user_id", "operation_id"}}, ids)
            await getattr(db, name).insert_one({**clean, "user_id": uid})
            count += 1
        restored[name] = count
    return {"restored": restored, "reused_categories": len(ids)}
