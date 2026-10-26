"""Minimal FINN-inspired append-only finance audit trail.

Unlike FINN audit.ts::undo, this module never replays database snapshots or
deletes settled records. A sanitized before/after summary accompanies each
UID-scoped mutation in the same Firestore transaction. No auth/rules changes.
"""
from datetime import datetime, timezone
from uuid import uuid4

from finnos.lib.money import cents

TRACKED = frozenset({
    "accounts", "institutions", "categories", "transactions",
    "cards", "budget_cycles", "subscriptions", "goals",
})


def visible_summary(collection: str, doc: dict | None) -> dict | None:
    if doc is None:
        return None
    result = {"name": str(doc.get("name") or "").strip()[:80]}
    for key in ("date", "status", "type", "category_id", "card_id", "account_id",
                "start_date", "end_date", "closing_day", "due_day"):
        if doc.get(key) is not None:
            result[key] = str(doc[key])[:80]
    for key in ("value", "monthly_budget", "monthly_goal", "initial_balance",
                "limit", "expected_income", "credit_amount", "refund_amount"):
        if doc.get(key) is not None:
            result[key + "_cents"] = cents(doc[key])
    if collection == "budget_cycles":
        result["allocated_cents"] = sum(
            cents(item.get("planned") or 0)
            for item in doc.get("allocations") or []
        )
        result["allocations_count"] = len(doc.get("allocations") or [])
    return result


def record_event(transaction, parent, collection: str, action: str,
                 before: dict | None, after: dict | None) -> None:
    if collection not in TRACKED:
        return
    origin = after or before
    if origin is None:
        return
    event_id = str(uuid4())
    event = {
        "id": event_id,
        "entity": collection,
        "entity_id": origin["id"],
        "action": action,
        "summary": f"{action}: {collection}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "before": visible_summary(collection, before),
        "after": visible_summary(collection, after),
    }
    transaction.create(parent.collection("finance_history").document(event_id), event)
