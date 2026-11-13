"""One default per kind of payment: a bank account, a credit card, a benefit.

Cash is its own kind. The flag is stored on the document; `effective_defaults`
fills the gap for owners who never chose one (the oldest active item of each
kind), so the register always has something sensible to preselect.
"""
from __future__ import annotations


def default_scope(collection: str, doc: dict) -> str:
    if collection == "cards":
        return "card"
    kind = doc.get("type", "corrente")
    if kind == "beneficio":
        return "benefit"
    if kind == "carteira":
        return "cash"
    return "account"


def other_defaults(collection: str, doc: dict, rows: list[dict]) -> list[dict]:
    """Documents that must lose the flag when `doc` becomes the default."""
    if not doc.get("is_default"):
        return []
    scope = default_scope(collection, doc)
    return [
        row for row in rows
        if row["id"] != doc["id"] and row.get("is_default") and default_scope(collection, row) == scope
    ]


def effective_defaults(collection: str, docs: list[dict]) -> set[str]:
    """IDs shown as default: the flagged one per scope, else the oldest active one."""
    chosen: dict[str, str] = {}
    for doc in docs:
        if doc.get("is_default") and doc.get("active", True):
            chosen.setdefault(default_scope(collection, doc), doc["id"])
    for doc in sorted(docs, key=lambda d: str(d.get("created_at") or "")):
        if doc.get("active", True):
            chosen.setdefault(default_scope(collection, doc), doc["id"])
    return set(chosen.values())
