"""Every lançamento of a person, also kept grouped by month in a few documents.

Reading the whole history costs one Firestore read per lançamento. The pack keeps the same raw documents grouped
by month (`users/{uid}/_tx_pack/{YYYY-MM}`), so the screens that need the whole history read one document per
month instead. It is a copy, never a source: the pack is marked with the finance revision it matches
(`users/{uid}/_meta/tx_pack`), and it is used only when that revision is the current one.

- Every write goes through `db.atomic`, which raises the finance revision. Right after it commits, `apply_changes`
  moves only the changed lançamentos in the pack and marks it with the new revision, in its own transaction that
  checks nothing else happened in between. Any doubt (another write in between, an error, a write the recorder did
  not see) leaves the pack on an old revision.
- A pack on an old revision is never read: the next reader streams the collection as before, and rebuilds the pack
  from what it just read, if the revision did not move meanwhile.

So a stale pack can only cost one full read; it can never show different data.
"""
import json
import logging
import os
from contextvars import ContextVar

logger = logging.getLogger(__name__)

PACK = "_tx_pack"
META_ID = "tx_pack"
SCHEMA = 1
MAX_MONTH_BYTES = 850_000   # a Firestore document holds 1 MiB
MAX_INDEX = 15_000          # ids kept in the meta document (id -> month)
PAGE_SIZE = 300


def enabled() -> bool:
    return os.getenv("FINNOS_TX_PACK", "1") != "0"


def month_of(raw: dict) -> str:
    value = raw.get("date")
    if isinstance(value, str) and len(value) >= 7 and value[4] == "-":
        return value[:7]
    return "sem-data"


def _meta_ref(parent):
    return parent.collection("_meta").document(META_ID)


def _stream_all(parent):
    collection = parent.collection("transactions")
    items, previous, previous_id = [], None, None
    from fastapi import HTTPException
    while True:
        query = collection.order_by("__name__")
        if previous is not None:
            query = query.start_after(previous)
        snapshots = list(query.limit(PAGE_SIZE).stream(timeout=15))
        if len(snapshots) > PAGE_SIZE:
            raise HTTPException(503, "Página financeira inválida.")
        for snap in snapshots:
            if previous_id is not None and snap.id <= previous_id:
                raise HTTPException(503, "Ordenação do histórico financeiro inválida.")
            raw = snap.to_dict()
            if not isinstance(raw, dict):
                raise HTTPException(503, "Registro financeiro inválido.")
            items.append((snap.id, raw))
            previous_id = snap.id
        if len(snapshots) < PAGE_SIZE:
            break
        previous = snapshots[-1]
    return items


def _read_pack(parent, expected_revision: int):
    meta_snap = _meta_ref(parent).get()
    meta = meta_snap.to_dict() if meta_snap.exists else None
    if not meta or meta.get("v") != SCHEMA or meta.get("rev") != expected_revision or meta.get("disabled"):
        return None
    stamps = meta.get("months") or {}
    refs = [parent.collection(PACK).document(m) for m in sorted(stamps)]
    items = []
    for snap in (parent._client.get_all(refs) if refs else []):
        data = snap.to_dict() if snap.exists else None
        if not data or data.get("stamp") != stamps.get(snap.id):
            return None
        items.extend((data.get("items") or {}).items())
    items.sort(key=lambda item: item[0])
    return items


def _too_big(month_docs: dict, index_size: int) -> bool:
    return index_size > MAX_INDEX or any(len(json.dumps(v, default=str)) > MAX_MONTH_BYTES for v in month_docs.values())


def _build(parent, items, revision: int) -> None:
    """Writes the pack for `items` (all of them) as revision `revision`, if it still is the current one."""
    from google.cloud import firestore
    by_month: dict[str, dict] = {}
    for tx_id, raw in items:
        by_month.setdefault(month_of(raw), {})[tx_id] = raw
    if _too_big(by_month, len(items)):
        meta, by_month = {"v": SCHEMA, "rev": revision, "disabled": True}, {}
    else:
        meta = {"v": SCHEMA, "rev": revision, "months": {m: revision for m in by_month},
                "where": {tx_id: month_of(raw) for tx_id, raw in items}}

    @firestore.transactional
    def run(tr):
        finance = parent.collection("_meta").document("finance").get(transaction=tr)
        current = (finance.to_dict() or {}) if finance.exists else {}
        if current.get("revision", 0) != revision:
            return
        for month, month_items in by_month.items():
            tr.set(parent.collection(PACK).document(month), {"stamp": revision, "items": month_items})
        tr.set(_meta_ref(parent), meta)

    run(parent._client.transaction(max_attempts=1))


def current_pack(parent, expected_revision: int):
    """The pack's items when it already matches the revision, else None (nothing is streamed or rebuilt)."""
    if not enabled():
        return None
    try:
        return _read_pack(parent, expected_revision)
    except Exception:
        logger.warning("tx pack unreadable", exc_info=True)
        return None


def raw_transactions(parent, expected_revision: int):
    """(id, raw document) of every lançamento, ordered by id: from the pack when it matches the revision, else
    from the collection (and the pack is rebuilt from that read)."""
    if enabled():
        try:
            packed = _read_pack(parent, expected_revision)
            if packed is not None:
                return packed
        except Exception:
            logger.warning("tx pack unreadable; reading the collection", exc_info=True)
    items = _stream_all(parent)
    if enabled():
        try:
            _build(parent, items, expected_revision)
        except Exception:
            logger.warning("tx pack not rebuilt", exc_info=True)
    return items


# --- Keeping the pack current after each write --------------------------------------------------

_changes: ContextVar[dict | None] = ContextVar("finnos_tx_pack_changes", default=None)
REREAD = object()


def _plain(value) -> bool:
    """False for write-time placeholders (server timestamp, increment, array ops, delete field)."""
    if isinstance(value, dict):
        return all(_plain(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return all(_plain(v) for v in value)
    return not type(value).__module__.startswith("google.cloud.firestore_v1.transforms")


def record_write(ref, data=None, *, deleted=False, partial=False) -> None:
    """Called for every write inside db.atomic; keeps the lançamentos it touched."""
    sink = _changes.get()
    if sink is None:
        return
    path = getattr(ref, "path", "") or ""
    parts = path.split("/")
    if len(parts) >= 4 and parts[-2] == "transactions":
        sink[parts[-1]] = None if deleted else (
            REREAD if partial or not isinstance(data, dict) or not _plain(data) else dict(data))


def watch_transaction(transaction):
    """Wraps the write methods of a Firestore transaction so every lançamento it writes is recorded."""
    if getattr(transaction, "_tx_pack_watched", False):
        return
    original = {name: getattr(transaction, name) for name in ("create", "set", "update", "delete")}

    def create(ref, data, *a, **k):
        record_write(ref, data)
        return original["create"](ref, data, *a, **k)

    def set_(ref, data, merge=False, *a, **k):
        record_write(ref, data, partial=bool(merge))
        return original["set"](ref, data, merge, *a, **k)

    def update(ref, data, *a, **k):
        record_write(ref, data, partial=True)
        return original["update"](ref, data, *a, **k)

    def delete(ref, *a, **k):
        record_write(ref, deleted=True)
        return original["delete"](ref, *a, **k)

    transaction.create, transaction.set, transaction.update, transaction.delete = create, set_, update, delete
    transaction._tx_pack_watched = True


def begin():
    return _changes.set({})


def take(token) -> dict:
    changes = _changes.get() or {}
    _changes.reset(token)
    return changes


def apply_changes(db, uid: str, before: int, changes: dict) -> None:
    """After a write committed revision `before + 1`: move the touched lançamentos in the pack and mark it with
    the new revision. Does nothing (the pack stays on the old revision) if anything does not line up."""
    if not enabled():
        return
    from google.cloud import firestore
    from finnos.lib.db import root
    parent = root(db, uid)
    after = before + 1

    @firestore.transactional
    def run(tr):
        meta_snap = _meta_ref(parent).get(transaction=tr)
        meta = meta_snap.to_dict() if meta_snap.exists else None
        if not meta or meta.get("v") != SCHEMA or meta.get("rev") != before or meta.get("disabled"):
            return
        finance = parent.collection("_meta").document("finance").get(transaction=tr)
        if not finance.exists or (finance.to_dict() or {}).get("revision") != after:
            return
        where = dict(meta.get("where") or {})
        stamps = dict(meta.get("months") or {})
        fresh = {}
        for tx_id, data in changes.items():
            if data is REREAD:
                snap = parent.collection("transactions").document(tx_id).get(transaction=tr)
                fresh[tx_id] = snap.to_dict() if snap.exists else None
            else:
                fresh[tx_id] = data
        touched = set()
        for tx_id, data in fresh.items():
            if tx_id in where:
                touched.add(where[tx_id])
            if data is not None:
                touched.add(month_of(data))
        month_docs = {}
        for month in touched:
            if month in stamps:
                snap = parent.collection(PACK).document(month).get(transaction=tr)
                doc = snap.to_dict() if snap.exists else None
                if not doc or doc.get("stamp") != stamps[month]:
                    return
                month_docs[month] = dict(doc.get("items") or {})
            else:
                month_docs[month] = {}
        for tx_id, data in fresh.items():
            old = where.pop(tx_id, None)
            if old is not None:
                month_docs[old].pop(tx_id, None)
            if data is not None:
                month = month_of(data)
                month_docs[month][tx_id] = data
                where[tx_id] = month
        if _too_big(month_docs, len(where)):
            tr.set(_meta_ref(parent), {"v": SCHEMA, "rev": after, "disabled": True})
            return
        # Only the touched months are written; the others keep their documents and stamps.
        for month, items in month_docs.items():
            ref = parent.collection(PACK).document(month)
            if items:
                tr.set(ref, {"stamp": after, "items": items})
                stamps[month] = after
            else:
                tr.delete(ref)
                stamps.pop(month, None)
        tr.set(_meta_ref(parent), {"v": SCHEMA, "rev": after, "months": stamps, "where": where})

    try:
        run(db.transaction(max_attempts=2))
    except Exception:
        logger.warning("tx pack not moved forward; it will be rebuilt on the next read", exc_info=True)
