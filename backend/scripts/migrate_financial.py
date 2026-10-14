"""Explicit, dry-run-first MongoDB to Firestore financial record migration.

Usage:
  python -m scripts.migrate_financial --mongo-user-id LEGACY_ID --firebase-uid VERIFIED_UID
  python -m scripts.migrate_financial --mongo-user-id LEGACY_ID --firebase-uid VERIFIED_UID --apply

The operator must independently verify that both IDs belong to the same person.
Never infer the Firebase UID from an email or unverified browser header.
"""
import argparse
import asyncio
from decimal import Decimal, ROUND_HALF_UP

from lib.db import db, client
from lib.firebase import get_firestore

KINDS = ("accounts", "categories", "cards", "transactions")

def cents(value):
    return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

def target_document(kind, source):
    doc = {key: value for key, value in source.items() if key not in ("_id", "user_id")}
    if not isinstance(doc.get("id"), str) or not doc["id"]:
        raise ValueError(f"Missing stable ID for {kind}")
    if kind == "transactions":
        doc["value_cents"] = cents(doc.pop("value"))
        if doc.get("adjusted_value") is not None:
            doc["adjusted_value_cents"] = cents(doc.pop("adjusted_value"))
        else:
            doc.pop("adjusted_value", None)
    return doc

async def run(mongo_user_id, firebase_uid, apply):
    if not mongo_user_id or not firebase_uid or mongo_user_id == firebase_uid:
        raise ValueError("Provide explicitly reviewed legacy and Firebase IDs")
    root = get_firestore().collection("users").document(firebase_uid)
    source_sets = {}
    for kind in KINDS:
        source_sets[kind] = await db[kind].find({"user_id": mongo_user_id}).to_list(length=None)
    for kind, docs in source_sets.items():
        ids = [d.get("id") for d in docs]
        if not all(isinstance(value, str) and value for value in ids) or len(ids) != len(set(ids)):
            raise ValueError(f"Invalid or duplicate source IDs: {kind}")
    accounts = {d["id"] for d in source_sets["accounts"]}
    categories = {d["id"] for d in source_sets["categories"]}
    cards = {d["id"] for d in source_sets["cards"]}
    for card in source_sets["cards"]:
        if card.get("payment_account_id") and card["payment_account_id"] not in accounts:
            raise ValueError("Orphaned payment account: " + card["id"])
    for tx in source_sets["transactions"]:
        for field, valid in (("account_id", accounts), ("to_account_id", accounts), ("category_id", categories), ("card_id", cards)):
            if tx.get(field) and tx[field] not in valid:
                raise ValueError("Orphaned transaction reference: " + tx["id"] + "/" + field)
    print("Source counts:", {key: len(docs) for key, docs in source_sets.items()})
    to_create = []
    for kind, docs in source_sets.items():
        for legacy in docs:
            target = target_document(kind, legacy)
            ref = root.collection(kind).document(target["id"])
            existing = ref.get()
            if existing.exists:
                if existing.to_dict() != target:
                    raise ValueError("Destination conflict at " + kind + "/" + target["id"])
                continue
            to_create.append((ref, target))
    print("New records required:", len(to_create))
    if not apply:
        print("DRY RUN: no records written")
        return
    from google.api_core.exceptions import Conflict
    for ref, doc in to_create:
        try:
            ref.create(doc)
        except Conflict:
            if ref.get().to_dict() != doc:
                raise
    for kind, docs in source_sets.items():
        expected = {d["id"] for d in docs}
        actual = {s.id for s in root.collection(kind).stream()}
        if expected != actual:
            raise RuntimeError("Post-copy ID reconciliation failed for " + kind)
    print("Reconciliation passed. MongoDB remains unchanged.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mongo-user-id", required=True)
    parser.add_argument("--firebase-uid", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        asyncio.run(run(args.mongo_user_id, args.firebase_uid, args.apply))
    finally:
        client.close()
