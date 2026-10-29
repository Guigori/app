"""FIN-09 historical invoice verification is advisory and never writes data."""
from copy import deepcopy
from finnos.lib.legacy_reconciliation import review_historical_invoices
from finnos.lib.finance_audit import KINDS, audit_finance


CARD = {
    "id": "card-1", "name": "Cartão antigo", "closing_day": 29, "due_day": 7,
    "payment_account_id": "bank",
}
PURCHASE = {
    "id": "purchase", "name": "Compra importada", "type": "despesa",
    "status": "pago", "card_id": "card-1", "account_id": "bank",
    "date": "2026-09-15", "value": 300,
}
PAID_CYCLE = {
    "items": [{
        "id": "purchase", "name": "Compra importada",
        "date": "2026-09-15", "purchase_cents": 30000,
    }],
    "paid_cents": 30000, "paid_at": "2026-10-07",
}
PAYMENT = {
    "id": "receipt", "name": "Pagamento", "invoice_payment": True,
    "invoice_card_id": "card-1", "invoice_cycle": "2026-09-29",
    "status": "pago", "type": "despesa", "account_id": "bank",
    "date": "2026-10-07", "value": 300,
}


def review(card=None, txs=None):
    cards = [card if card is not None else deepcopy(CARD)]
    transactions = txs if txs is not None else [deepcopy(PURCHASE)]
    before = deepcopy((cards, transactions))
    result = review_historical_invoices(cards, transactions, "2026-10-26")
    assert (cards, transactions) == before  # never writes or backfills payments
    assert result["auto_fixed"] is False
    assert result["legacy_source_compared"] is False
    return result


def test_closed_import_without_snapshot_is_not_marked_settled():
    report = review()
    assert report["status"] == "review_required"
    assert report["counts"]["closed_cycles_without_snapshot"] == 1
    assert report["counts"]["unmatched_paid_snapshots"] == 0
    assert report["examples"][0]["cycle"] == "2026-09-29"


def test_saved_paid_cycle_with_matching_bank_debit_needs_no_review():
    card = deepcopy(CARD)
    card["invoice_cycles"] = {"2026-09-29": deepcopy(PAID_CYCLE)}
    report = review(card, [deepcopy(PURCHASE), deepcopy(PAYMENT)])
    assert report["status"] == "no_issues_detected_not_migration_verified"
    assert all(value == 0 for value in report["counts"].values())


def test_imported_paid_snapshot_missing_bank_debit_is_manual_review_not_synthetic_cash():
    card = deepcopy(CARD)
    card["invoice_cycles"] = {"2026-09-29": deepcopy(PAID_CYCLE)}
    report = review(card, [deepcopy(PURCHASE)])
    assert report["counts"]["unmatched_paid_snapshots"] == 1
    assert report["examples"][0]["recorded_paid_cents"] == 30000
    assert report["examples"][0]["matched_bank_payment_cents"] == 0


def test_payment_receipt_without_saved_snapshot_is_flagged():
    report = review(deepcopy(CARD), [deepcopy(PURCHASE), deepcopy(PAYMENT)])
    assert report["counts"]["bank_payments_without_snapshot"] == 1
    assert report["counts"]["closed_cycles_without_snapshot"] == 1


def test_archived_snapshot_item_survives_but_requires_original_transaction_reconciliation():
    card = deepcopy(CARD)
    card["invoice_cycles"] = {"2026-09-29": deepcopy(PAID_CYCLE)}
    report = review(card, [deepcopy(PAYMENT)])
    assert report["counts"]["archived_items_without_purchase"] == 1
    assert report["counts"]["unmatched_paid_snapshots"] == 0


def test_integrity_remains_true_for_ambiguous_import_but_flags_review():
    records = {kind: [] for kind in KINDS}
    records["accounts"] = [{"id": "bank", "initial_balance": 1000}]
    records["cards"] = [deepcopy(CARD)]
    records["transactions"] = [deepcopy(PURCHASE)]
    result = audit_finance(records)
    assert result["integrity_ok"] is True
    assert result["historical_invoices"]["status"] == "review_required"
    assert result["legacy_reconciliation"] == "not_verified"
    assert result["total_account_balance"] == 1000


def test_review_samples_are_bounded_and_invalid_import_money_is_not_accepted():
    card = deepcopy(CARD)
    card["invoice_cycles"] = {
        f"2025-{month:02d}-29": {
            "items": [], "paid_cents": 1000
        } for month in range(1, 7)
    }
    card["invoice_cycles"]["2025-07-29"] = {"items": [], "paid_cents": "-1"}
    report = review_historical_invoices(
        [card], [], "2026-10-26", sample_limit=3,
    )
    assert report["counts"]["unmatched_paid_snapshots"] == 6
    assert report["counts"]["invalid_legacy_amounts"] == 1
    assert len(report["examples"]) == 3
