"""Emulator-only atomic finance event outbox for shadow aggregate integration.

Default: OFF. An opt-in is valid ONLY for a synthetic UID in a demo-* Firebase
project pointed at a local Firestore emulator. There is no production fallback,
no read path using these events, and no persisted copies of raw user documents.

The outbox writes alongside the canonical transaction and the finance revision:
a complete ordered revision stream can later be independently reconciled before
materializing a shadow projection. Card credits/refunds and any incomplete
transaction preimage explicitly demand a full rebuild; never infer their
category from an audit summary.
"""
import os
from contextvars import ContextVar
from dataclasses import dataclass, field
from fastapi import HTTPException

from finnos.lib.monthly_aggregate_shadow import IncrementalMonthlyLedger

_capture = ContextVar("finnos_shadow_emulator_capture", default=None)

SCHEMA_VERSION = 1
EMULATOR_MODE = "emulator"


@dataclass
class Capture:
    uid: str
    before_revision: int
    events: list[dict] = field(default_factory=list)


def emulator_enabled(uid: str) -> bool:
    mode = os.environ.get("FINNOS_SHADOW_OUTBOX_MODE", "")
    if not mode:
        return False
    valid = (
        mode == EMULATOR_MODE
        and os.environ.get("FIRESTORE_EMULATOR_HOST", "") != ""
        and os.environ.get("FIREBASE_PROJECT_ID", "").startswith("demo-")
        and uid.startswith("test-")
        and 5 <= len(uid) <= 1500
        and "/" not in uid
    )
    if not valid:
        raise HTTPException(
            503, "Captura financeira shadow permitida somente no emulador sintético."
        )
    return True


def begin(uid: str, before_revision: int):
    """Return context token or None; callers reset in a transaction finally."""
    if not emulator_enabled(uid):
        return None
    if type(before_revision) is not int or before_revision < 0:
        raise HTTPException(503, "Revisão financeira inválida.")
    return _capture.set(Capture(uid, before_revision))


def _months_delta(before: dict | None, after: dict | None):
    """Exact cents by month with sign. Never stores a financial record."""
    engine = IncrementalMonthlyLedger()
    engine.transaction_changed(before, after)
    return {
        month: values.row()
        for month, values in sorted(engine.months.items())
    }


def capture_event(entity: str, action: str, before: dict | None,
                  after: dict | None):
    current = _capture.get()
    if current is None:
        return
    original = after or before
    if original is None or not original.get("id"):
        raise HTTPException(503, "Evento de alteração financeira inválido.")
    if entity == "transactions":
        if any(x is not None and x.get("user_id") != current.uid
               for x in (before, after)):
            raise HTTPException(503, "Evento financeiro fora do UID autorizado.")
        # Both images must be full source documents. If not, preserve the
        # revision marker but refuse to treat the delta as authoritative.
        try:
            delta = _months_delta(before, after)
        except (KeyError, TypeError, ValueError, OverflowError):
            delta = {}
            rebuild = True
        else:
            # A historic card purchase might have refunds/merchant credits
            # in other months. Its category or amount cannot be updated
            # safely without reading those ledgers in this transaction.
            # The envelope captures exact transaction cents, but replay
            # MUST rebuild instead of treating that delta as complete.
            rebuild = bool(
                (before is not None and before.get("card_id"))
                or (after is not None and after.get("card_id"))
            )
        source_count_delta = int(after is not None) - int(before is not None)
    else:
        delta = {}
        source_count_delta = 0
        # Changing the source ledger of credits, card rules, or account
        # metadata is not reconstructible from the transaction-only delta.
        rebuild = True
    current.events.append({
        "entity": entity,
        "entity_id": original["id"],
        "action": action,
        "delta_months": delta,
        "source_count_delta": source_count_delta,
        "requires_rebuild": rebuild,
    })


def finish(transaction, parent, before_revision: int):
    current = _capture.get()
    if current is None:
        return
    if current.before_revision != before_revision:
        raise HTTPException(409, "Revisão do outbox financeiro incompatível.")
    next_revision = before_revision + 1
    transaction.create(
        parent.collection("_finance_shadow_outbox_v1").document(
            f"{next_revision:016d}"
        ),
        {
            "schema_version": SCHEMA_VERSION,
            "status": "emulator_only",
            "finance_revision": next_revision,
            "previous_revision": before_revision,
            "user_id": current.uid,
            "events": current.events,
            "requires_rebuild": any(
                item["requires_rebuild"] for item in current.events
            ),
            "is_noop": not bool(current.events),
        },
    )


def end(token):
    if token is not None:
        _capture.reset(token)
