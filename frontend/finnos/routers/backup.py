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
    "goals", "budget_cycles", "transactions", "notification_preferences",
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
