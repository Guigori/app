"""Every account and card belongs to an institution (except cash).

`resolve_institution` turns a typed bank name into the owner's institution,
creating it when it does not exist yet — the same exact-name rule as the
registry (no aliases). `link_legacy` runs it over older accounts and cards that
only carry the name as free text; it is idempotent and never changes money.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from finnos.lib.db import db
from finnos.lib.institution_catalog import institution_identity
from finnos.lib.institutions import institution_key

# Cash has no institution; benefits do (Alelo, VR…), banks do.
NO_INSTITUTION_TYPES = {"carteira"}


def needs_institution(collection: str, doc: dict) -> bool:
    return collection == "cards" or doc.get("type", "corrente") not in NO_INSTITUTION_TYPES


async def _find_by_name(user_id: str, name: str) -> dict | None:
    key = institution_key(name)
    docs = await db.institutions.find({"user_id": user_id}).to_list(500)
    return next((d for d in docs if institution_key(d.get("name", "")) == key), None)


async def create_institution_doc(user_id: str, name: str, catalog_id: str | None = None) -> tuple[dict, bool]:
    """Return (institution, created). An existing exact name is reused."""
    identity = institution_identity(name, catalog_id)
    if len(identity["name"]) < 2:
        raise HTTPException(422, "Informe o nome da instituição.")
    existing = await _find_by_name(user_id, identity["name"])
    if existing:
        return existing, False
    now = datetime.now(timezone.utc)
    doc = dict(id=str(uuid.uuid4()), user_id=user_id, **identity, created_at=now, updated_at=now)
    try:
        await db.institutions.insert_one(doc)
    except HTTPException as error:
        # Another device created the same name between the read and the write.
        if error.status_code != 409:
            raise
        existing = await _find_by_name(user_id, identity["name"])
        if not existing:
            raise
        return existing, False
    return doc, True


async def resolve_institution(user_id: str, collection: str, payload: dict) -> dict:
    """Fill institution_id from the typed name when the client did not send one."""
    if payload.get("institution_id") or not needs_institution(collection, payload):
        return payload
    name = " ".join((payload.get("institution") or "").split())
    if len(name) < 2:
        return payload
    institution, _ = await create_institution_doc(user_id, name)
    return {**payload, "institution_id": institution["id"], "institution": institution["name"]}


async def link_legacy(user_id: str) -> dict:
    created = 0
    linked = {"accounts": 0, "cards": 0}
    cache: dict[str, dict] = {}
    for collection in ("accounts", "cards"):
        docs = await getattr(db, collection).find({"user_id": user_id}).to_list(500)
        for doc in docs:
            name = " ".join((doc.get("institution") or "").split())
            if doc.get("institution_id") or len(name) < 2 or not needs_institution(collection, doc):
                continue
            key = institution_key(name)
            if key not in cache:
                institution, was_created = await create_institution_doc(user_id, name)
                cache[key] = institution
                created += int(was_created)
            result = await getattr(db, collection).update_one(
                {"id": doc["id"], "user_id": user_id},
                {"$set": {"institution_id": cache[key]["id"], "updated_at": datetime.now(timezone.utc)}},
            )
            linked[collection] += int(bool(result.matched_count))
    return {"linked_accounts": linked["accounts"], "linked_cards": linked["cards"], "created_institutions": created}
