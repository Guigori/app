"""Incremental monthly aggregates remain shadow-only until exact reconciliation.

All tests are synthetic and never use Firestore credentials or user records.
"""
from copy import deepcopy
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib.money import cents
from finnos.lib.monthly_aggregate_shadow import (
    IncrementalMonthlyLedger, reconcile_months, stage_shadow_snapshot,
    snapshot_checksum,
)


def tx(identifier, amount, month, **props):
    return {
        "id": identifier, "name": identifier, "type": "despesa",
        "status": "pago", "date": month + "-20",
        "value": Decimal(amount), "installment": False,
        "category_id": "food", "card_id": None,
        "account_id": "bank", **props,
    }


def sample():
    source = [
        tx("rent", "1234.56", "2026-10"),
        tx("uncategorized", "1.01", "2026-10", category_id=None),
        tx("card-purchase", "300", "2026-09", card_id="card",
           category_id="shopping"),
        tx("parcel", "100", "2026-08", card_id="card",
           category_id="shopping", installment=True,
           total_installments=3, current_installment=1),
        {
            "id": "salary", "name": "Salário", "type": "receita",
            "status": "pago", "date": "2026-10-05",
            "value": Decimal("2200.00"), "account_id": "bank",
        },
        {
            "id": "receipt", "name": "Reembolso", "type": "receita",
            "status": "pago", "date": "2026-10-26",
            "value": Decimal("50"), "account_id": "bank",
            "invoice_refund": True,
        },
        {
            "id": "paid-invoice", "name": "Fatura", "type": "despesa",
            "status": "pago", "date": "2026-10-07",
            "value": Decimal("200"), "account_id": "bank",
            "invoice_payment": True,
        },
        {
            "id": "bank-move", "name": "Transferência", "type": "transferencia",
            "status": "pago", "date": "2026-10-11",
            "value": Decimal("10"), "account_id": "bank",
            "to_account_id": "other",
        },
    ]
    cards = [{
        "id": "card", "invoice_adjustments": {"2026-09-29": [
            {
                "id": "merchant", "purchase_id": "card-purchase",
                "credit_cents": 2500, "date": "2026-10-25",
            }
        ]},
        "invoice_refunds": {"2026-09-29": [
            {
                "id": "receipt", "purchase_id": "card-purchase",
                "refund_cents": 5000, "date": "2026-10-26",
            }
        ]},
    }]
    return source, cards


def test_rebuild_matches_canonical_monthly_competency_exactly():
    source, cards = sample()
    ledger = IncrementalMonthlyLedger.from_history(source, cards)
    snap = ledger.snapshot(123)
    assert snap["status"] == "shadow_only"
    assert snap["finance_revision"] == 123
    assert snap["checksum"] == snapshot_checksum(snap)
    assert snap["months"]["2026-10"]["income_cents"] == 220000
    assert snap["months"]["2026-10"]["expense_cents"] == (
        123456 + 101 + 3334 - 2500 - 5000
    )
    assert snap["months"]["2026-10"]["categories_cents"][""] == 101
    result = reconcile_months(snap, source, cards, 123)
    assert result["match"], result
    assert result["diffs"] == {}
    assert result["production_eligible"] is False


def test_incremental_edit_delete_and_card_credit_match_complete_rebuild():
    before, cards = sample()
    ledger = IncrementalMonthlyLedger.from_history(before, cards)
    after = deepcopy(before)
    changed = tx("rent", "500.10", "2026-11")
    original = next(item for item in after if item["id"] == "rent")
    ledger.transaction_changed(original, changed)
    after[after.index(original)] = changed
    deleted = next(item for item in after if item["id"] == "uncategorized")
    ledger.transaction_changed(deleted, None)
    after.remove(deleted)
    new_income = {
        "id": "bonus", "date": "2026-11-02", "value": Decimal("79.99"),
        "type": "receita", "status": "pago", "account_id": "bank",
    }
    ledger.transaction_changed(None, new_income)
    after.append(new_income)

    updated_cards = deepcopy(cards)
    updated_cards[0]["invoice_adjustments"]["2026-09-29"][0]["credit_cents"] = 5000
    refs = {x["id"]: x for x in after}
    ledger.card_credits_changed(cards[0], updated_cards[0], refs)

    incremental = ledger.snapshot(124)
    rebuilt = IncrementalMonthlyLedger.from_history(after, updated_cards).snapshot(124)
    assert incremental["months"] == rebuilt["months"]
    assert incremental["checksum"] == rebuilt["checksum"]
    assert reconcile_months(incremental, after, updated_cards, 124)["match"]


def test_drift_tampering_stale_revision_and_orphan_credits_fail_closed():
    source, cards = sample()
    snap = IncrementalMonthlyLedger.from_history(source, cards).snapshot(8)
    changed = deepcopy(snap)
    changed["months"]["2026-10"]["expense_cents"] += 1
    assert reconcile_months(changed, source, cards, 8)["reason"] == "stale_or_unknown_schema"
    changed["checksum"] = snapshot_checksum(changed)
    report = reconcile_months(changed, source, cards, 8)
    assert report["reason"] == "mismatch"
    assert "2026-10" in report["diffs"]
    assert reconcile_months(snap, source, cards, 9)["reason"] == "stale_or_unknown_schema"

    missing_original = [t for t in source if t["id"] != "card-purchase"]
    with pytest.raises(ValueError, match="compra original"):
        IncrementalMonthlyLedger.from_history(missing_original, cards)


class DocRef:
    def __init__(self, value=None):
        self.value = value

    def get(self, transaction=None):
        value = self.value
        return type("Snap", (), {
            "exists": value is not None,
            "to_dict": lambda self: value,
        })()


class Parent:
    def __init__(self, current):
        self.current = current
        self.refs = {}

    def collection(self, kind):
        owner = self
        class Collection:
            def document(self, identifier):
                if kind == "_meta":
                    assert identifier == "finance"
                    return DocRef({"revision": owner.current})
                assert kind == "_finance_month_shadows_v1"
                return owner.refs.setdefault(identifier, DocRef())
        return Collection()


class Txn:
    def __init__(self):
        self.writes = []

    def set(self, doc, value):
        self.writes.append((doc, value))


def test_shadow_materialization_requires_opt_in_and_matching_revision():
    source, cards = sample()
    snapshot = IncrementalMonthlyLedger.from_history(source, cards).snapshot(10)
    parent, transaction = Parent(10), Txn()
    with pytest.raises(HTTPException) as prohibited:
        stage_shadow_snapshot(transaction, parent, snapshot, 10)
    assert prohibited.value.status_code == 403
    assert transaction.writes == []

    parent.current = 11
    with pytest.raises(HTTPException) as conflict:
        stage_shadow_snapshot(transaction, parent, snapshot, 10, approval=True)
    assert conflict.value.status_code == 409
    assert transaction.writes == []

    parent.current = 10
    stage_shadow_snapshot(transaction, parent, snapshot, 10, approval=True)
    assert len(transaction.writes) == len(snapshot["months"])
    assert all(value["status"] == "shadow_only" for _, value in transaction.writes)
    assert all(value["finance_revision"] == 10 for _, value in transaction.writes)
