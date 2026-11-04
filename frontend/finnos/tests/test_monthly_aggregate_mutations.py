"""Shadow-only write-path parity: cash receipts, old refunds, edits, replay.

Exercise the same shapes emitted by synchronous CRUD, imported/offline events,
invoice payments, bank refunds and merchant credits. No actual Firestore writes.
"""
from copy import deepcopy
from decimal import Decimal

import pytest

from finnos.lib.monthly_aggregate_shadow import (
    IncrementalMonthlyLedger, reconcile_months,
)
from finnos.lib.monthly_aggregate_mutations import apply_shadow_mutations


def money_tx(identifier, *, value=100, kind="despesa", when="2026-09-15",
             category="shopping", **kwargs):
    return {
        "id": identifier, "user_id": "shadow-uid", "name": identifier, "date": when,
        "value": Decimal(str(value)), "type": kind, "status": "pago",
        "account_id": "bank", "category_id": category, **kwargs,
    }


def initial():
    original = money_tx("purchase", value="300.00", card_id="card")
    salary = money_tx("salary", value="3100.00", kind="receita",
                      when="2026-10-05", category=None)
    bank_debit = money_tx("invoice-payment", value="300.00",
                          when="2026-10-07", invoice_payment=True)
    card = {"id": "card", "user_id": "shadow-uid", "name": "Cartão", "invoice_adjustments": {},
            "invoice_refunds": {}}
    transactions = {x["id"]: x for x in (original, salary, bank_debit)}
    cards = {card["id"]: card}
    ledger = IncrementalMonthlyLedger.from_history(
        list(transactions.values()), list(cards.values())
    )
    return ledger, transactions, cards


def _step(ledger, transactions, cards, changes=None, card_changes=None,
          revision=1):
    result = apply_shadow_mutations(
        ledger, transactions, cards, user_id="shadow-uid", before_revision=revision,
        after_revision=revision + 1, transaction_changes=changes,
        card_changes=card_changes,
    )
    expected = IncrementalMonthlyLedger.from_history(
        list(result.transactions.values()), list(result.cards.values())
    )
    assert result.ledger.snapshot(result.revision) == expected.snapshot(result.revision)
    report = reconcile_months(
        result.ledger.snapshot(result.revision),
        list(result.transactions.values()), list(result.cards.values()),
        result.revision,
    )
    assert report["match"], report
    return result


def test_financial_mutations_reconcile_original_category_after_old_refund():
    ledger, txs, cards = initial()
    original_before = deepcopy(txs["purchase"])
    card_before = deepcopy(cards["card"])

    # FIN-05/09: the refund is recorded in October, against a September
    # purchase. Its category must later follow any authorized reclassification.
    refund_card = deepcopy(card_before)
    refund_card["invoice_adjustments"] = {
        "2026-09-29": [{
            "id": "credit", "purchase_id": "purchase",
            "date": "2026-10-24", "credit_cents": 5000,
        }]
    }
    result = _step(ledger, txs, cards, card_changes=[(card_before, refund_card)])
    assert result.ledger.months["2026-10"].categories_cents["shopping"] == -5000

    corrected = {**original_before, "category_id": "electronics"}
    result2 = _step(
        result.ledger, result.transactions, result.cards,
        changes=[(original_before, corrected)], revision=2,
    )
    categories = result2.ledger.months["2026-10"].categories_cents
    assert "shopping" not in categories
    assert categories["electronics"] == -5000
    assert result2.ledger.months["2026-09"].categories_cents["electronics"] == 30000


def test_invoice_refund_receipt_and_card_ledger_in_same_atomic_batch():
    ledger, txs, cards = initial()
    card_before = deepcopy(cards["card"])
    refunded = deepcopy(card_before)
    refunded["invoice_refunds"] = {
        "2026-09-29": [{
            "id": "refund", "purchase_id": "purchase",
            "date": "2026-10-27", "refund_cents": 10000,
        }]
    }
    receipt = money_tx(
        "refund", value=100, kind="receita", when="2026-10-27",
        category=None, invoice_refund=True,
    )
    result = _step(
        ledger, txs, cards, changes=[(None, receipt)],
        card_changes=[(card_before, refunded)],
    )
    assert result.ledger.months["2026-10"].income_cents == 310000
    assert result.ledger.months["2026-10"].expense_cents == -10000
    # Bank receipt is cash-only, never a second salary.
    assert result.ledger.months["2026-10"].categories_cents["shopping"] == -10000
    assert result.changed_months == ["2026-10"]


def test_offline_replay_stale_preimage_is_rejected_without_double_count():
    ledger, txs, cards = initial()
    imported = money_tx("import-1", value="12.34", when="2026-11-03")
    result = _step(ledger, txs, cards, changes=[(None, imported)])
    assert "import-1" not in txs
    with pytest.raises(ValueError, match="Criação repetida"):
        apply_shadow_mutations(
            result.ledger, result.transactions, result.cards,
            user_id="shadow-uid",
            transaction_changes=[(None, imported)],
            before_revision=2, after_revision=3,
        )
    assert result.ledger.snapshot(2) == IncrementalMonthlyLedger.from_history(
        list(result.transactions.values()), list(result.cards.values())
    ).snapshot(2)


def test_referencing_deleted_original_fails_without_touching_previous_snapshot():
    ledger, txs, cards = initial()
    original = deepcopy(txs["purchase"])
    card_before = deepcopy(cards["card"])
    revised_card = deepcopy(card_before)
    revised_card["invoice_adjustments"] = {
        "2026-09-29": [{
            "id": "credit", "purchase_id": "purchase",
            "date": "2026-10-24", "credit_cents": 1000,
        }]
    }
    before_snapshot = ledger.snapshot(1)
    with pytest.raises(ValueError, match="compra original"):
        apply_shadow_mutations(
            ledger, txs, cards, user_id="shadow-uid",
            transaction_changes=[(original, None)],
            card_changes=[(card_before, revised_card)],
            before_revision=1, after_revision=2,
        )
    assert ledger.snapshot(1) == before_snapshot
    assert "purchase" in txs
    assert cards["card"]["invoice_adjustments"] == {}


def test_foreign_uid_cannot_contaminate_incremental_totals():
    ledger, txs, cards = initial()
    before = ledger.snapshot(1)
    fake = money_tx("injection", value="9999.99")
    fake["user_id"] = "another-user"
    with pytest.raises(ValueError, match="outro usuário"):
        apply_shadow_mutations(
            ledger, txs, cards, user_id="shadow-uid",
            transaction_changes=[(None, fake)],
            before_revision=1, after_revision=2,
        )
    assert ledger.snapshot(1) == before


def test_card_credit_revision_must_be_consecutive_and_preimage_exact():
    ledger, txs, cards = initial()
    with pytest.raises(ValueError, match="consecutiva"):
        apply_shadow_mutations(
            ledger, txs, cards, user_id="shadow-uid",
            transaction_changes=[(None, money_tx("bonus", kind="receita"))],
            before_revision=1, after_revision=3,
        )
    with pytest.raises(ValueError, match="desatualizada"):
        apply_shadow_mutations(
            ledger, txs, cards, user_id="shadow-uid",
            transaction_changes=[(
                {**txs["salary"], "value": Decimal("1")},
                {**txs["salary"], "value": Decimal("2")},
            )],
            before_revision=1, after_revision=2,
        )
    with pytest.raises(ValueError, match="duplicada"):
        apply_shadow_mutations(
            ledger, txs, cards, user_id="shadow-uid",
            transaction_changes=[
                (None, money_tx("bonus")),
                (None, money_tx("bonus")),
            ],
            before_revision=1, after_revision=2,
        )
