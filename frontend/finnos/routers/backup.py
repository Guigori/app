"""Complete, read-only backup of one user's FINNOS data (Fase 1: proteção dos dados).

The export is scoped to the verified Firebase UID and is consistent: the
financial revision is read before and after the collections, and a concurrent
write makes the request fail (409) instead of returning a mixed snapshot.
Nothing is truncated silently: the adapter raises above its read limit.
Secrets (AI provider keys) and internal sync receipts are never exported.
"""
import base64
import gzip
import hashlib
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.encoders import jsonable_encoder
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
    # The owner is implied by the account that restores the file. Values are made
    # JSON-native here (datetimes → ISO strings, Decimal → number) so the checksum is
    # computed over exactly what the downloaded file contains.
    return jsonable_encoder({key: value for key, value in doc.items() if key != "user_id"})


@router.get("/backup")
async def export_backup(user: dict = Depends(require_user)):
    return await build_backup(user["id"])


async def build_backup(uid: str) -> dict:
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
RESTORE_MUST_BE_EMPTY = ("institutions", "accounts", "cards", "subscriptions", "goals", "budget_cycles", "transactions")


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



# --- Weekly server-side copies ------------------------------------------------
# Each copy is the same checksummed backup, gzip + base64, split into parts so a
# large history never exceeds Firestore's 1 MiB document limit. The metadata
# document is written last: a copy without it is incomplete and never listed.
SNAPSHOT_KEEP = 8
SNAPSHOT_PART = 700_000
SNAPSHOT_MIN_INTERVAL = timedelta(days=6)
CRON_USER_LIMIT = 500


def _snapshots(uid: str):
    return store.root(store.client(), uid).collection("backup_snapshots")


def encode_snapshot(data: dict) -> list[str]:
    raw = base64.b64encode(gzip.compress(json.dumps(data, default=str, ensure_ascii=False).encode("utf-8"))).decode("ascii")
    return [raw[i:i + SNAPSHOT_PART] for i in range(0, len(raw), SNAPSHOT_PART)] or [""]


def decode_snapshot(parts: list[str]) -> dict:
    return json.loads(gzip.decompress(base64.b64decode("".join(parts))).decode("utf-8"))


def _list_snapshots(uid: str) -> list[dict]:
    rows = []
    for snap in _snapshots(uid).stream(timeout=15):
        meta = snap.to_dict() or {}
        if meta.get("created_at"):
            rows.append({"id": snap.id, **{k: meta[k] for k in ("created_at", "counts", "parts", "bytes", "source") if k in meta}})
    return sorted(rows, key=lambda r: r["id"], reverse=True)


async def save_snapshot(uid: str, source: str) -> dict:
    data = await build_backup(uid)
    parts = encode_snapshot(data)
    sid = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    def write():
        ref = _snapshots(uid).document(sid)
        for n, part in enumerate(parts):
            ref.collection("parts").document(f"{n:04d}").set({"data": part})
        meta = {"created_at": data["exported_at"], "counts": data["counts"], "checksum_sha256": data["checksum_sha256"], "parts": len(parts), "bytes": sum(map(len, parts)), "source": source}
        ref.set(meta)
        # Retention: keep the newest copies only (these are FINNOS's own copies, not user records).
        for old in sorted(_snapshots(uid).list_documents(), key=lambda d: d.id, reverse=True)[SNAPSHOT_KEEP:]:
            for part in old.collection("parts").list_documents():
                part.delete()
            old.delete()
        return {"id": sid, **{k: meta[k] for k in ("created_at", "counts", "parts", "bytes", "source")}}

    return await run_in_threadpool(write)


@router.get("/backups")
async def list_snapshots(user: dict = Depends(require_user)):
    return {"items": await run_in_threadpool(lambda: _list_snapshots(user["id"])), "keep": SNAPSHOT_KEEP}


@router.post("/backups", status_code=201)
async def create_snapshot(user: dict = Depends(require_user)):
    uid = user["id"]
    latest = await run_in_threadpool(lambda: _list_snapshots(uid))
    if latest and datetime.fromisoformat(latest[0]["created_at"]) > datetime.now(timezone.utc) - timedelta(minutes=10):
        raise HTTPException(429, "Uma cópia acabou de ser guardada. Tente de novo em alguns minutos.")
    return await save_snapshot(uid, "manual")


@router.get("/backups/{snapshot_id}")
async def download_snapshot(snapshot_id: str, user: dict = Depends(require_user)):
    uid = user["id"]

    def read():
        ref = _snapshots(uid).document(store.resource_id(snapshot_id))
        meta = ref.get()
        if not meta.exists or not (meta.to_dict() or {}).get("created_at"):
            raise HTTPException(404, "Cópia não encontrada.")
        parts = [doc.to_dict().get("data", "") for doc in sorted(ref.collection("parts").stream(timeout=15), key=lambda d: d.id)]
        return meta.to_dict(), parts

    meta, parts = await run_in_threadpool(read)
    if len(parts) != meta.get("parts"):
        raise HTTPException(409, "Cópia incompleta.")
    data = decode_snapshot(parts)
    if data.get("checksum_sha256") != checksum(data.get("collections", {})):
        raise HTTPException(409, "Cópia corrompida (checksum não confere).")
    return data


@router.get("/backups-run")
async def run_weekly_snapshots(authorization: str | None = Header(default=None)):
    """Weekly job (GitHub Actions, Bearer FINNOS_CRON_SECRET): one copy per user, at most every 6 days."""
    from finnos.lib.push_transport import require_cron_secret

    require_cron_secret(authorization)
    users = await run_in_threadpool(lambda: [ref.id for ref in store.client().collection("users").list_documents(page_size=CRON_USER_LIMIT + 1)])
    if len(users) > CRON_USER_LIMIT:
        raise HTTPException(503, "Mais usuários que o limite do backup semanal; paginação necessária.")
    saved = skipped = failed = 0
    for uid in users:
        token = store.active_uid.set(uid)
        try:
            latest = await run_in_threadpool(lambda: _list_snapshots(uid))
            if latest and datetime.fromisoformat(latest[0]["created_at"]) > datetime.now(timezone.utc) - SNAPSHOT_MIN_INTERVAL:
                skipped += 1
                continue
            await save_snapshot(uid, "semanal")
            saved += 1
        except Exception:  # one user's failure never stops the others; counts only, no data in logs
            failed += 1
        finally:
            store.active_uid.reset(token)
    return {"users": len(users), "saved": saved, "skipped": skipped, "failed": failed}
