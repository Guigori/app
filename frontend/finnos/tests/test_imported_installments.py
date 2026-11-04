"""FIN-04: an imported k/n purchase starts at installment k, not 1.

For an imported k/n purchase, tx.date denotes the first *remaining*
installment date, and tx.value is the original full purchase total.
"""
from datetime import date

import pytest

from finnos.lib.invoices import occurrences, invoice_state, commitment
from finnos.lib.money import D, installment_portion, remaining_installment_indices
from finnos.lib.stats import month_portion, balance_effects
from finnos.routers.budgets import _occurrences_in_cycle


def card():
    return {"id": "card", "name": "Cartão", "closing_day": 29, "due_day": 7, "invoice_cycles": {}}


def imported(k=7, n=10, total=1000, card_id="card"):
    return {
        "id": "imported", "name": "Notebook", "type": "despesa", "status": "pago",
        "date": "2026-10-20", "value": total, "account_id": "bank",
        "card_id": card_id, "category_id": "shopping", "installment": True,
        "total_installments": n, "current_installment": k,
    }


def test_imported_seventh_of_ten_has_only_four_bills():
    tx = imported()
    result = occurrences(card(), tx)
    assert [cycle for cycle, _, _ in result] == [
        "2026-10-29", "2026-11-29", "2026-12-29", "2027-01-29"
    ]
    assert [label for _, _, label in result] == ["7/10", "8/10", "9/10", "10/10"]
    assert [cents for _, cents, _ in result] == [10000] * 4
    assert commitment(card(), [tx], "2026-10-29") == (10000, 30000, 40000)
    assert invoice_state(card(), [tx], "2026-10-29")["items"][0]["installment_label"] == "7/10"


def test_monthly_competency_uses_original_installment_index():
    tx = imported(k=2, n=3, total=100)
    assert month_portion(tx, "2026-09") is None
    assert month_portion(tx, "2026-10") == D("33.33")
    assert month_portion(tx, "2026-11") == D("33.34")
    assert month_portion(tx, "2026-12") is None
    assert sum(month_portion(tx, m) for m in ["2026-10", "2026-11"]) == D("66.67")


def test_budget_cycle_contains_only_remaining_occurrences():
    tx = imported()
    result = _occurrences_in_cycle(tx, date(2026, 10, 1), date(2027, 2, 28))
    assert [day for day, _, _ in result] == [
        date(2026, 10, 20), date(2026, 11, 20),
        date(2026, 12, 20), date(2027, 1, 20),
    ]
    assert sum(value for _, value, _ in result) == D("400")


def test_bank_balance_does_not_reintroduce_installments_before_k():
    tx = imported(k=7, n=10, card_id=None)
    assert balance_effects(tx, "2026-10-19") == []
    assert balance_effects(tx, "2026-10-20") == [("bank", -100)]
    assert balance_effects(tx, "2026-12-20") == [("bank", -300)]
    assert balance_effects(tx, "2027-02-20") == [("bank", -400)]


def test_last_installment_cent_remainder_is_preserved():
    tx = imported(k=3, n=3, total=100)
    assert [cents for _, cents, _ in occurrences(card(), tx)] == [3334]
    assert [label for _, _, label in occurrences(card(), tx)] == ["3/3"]


def test_old_paid_snapshot_does_not_double_count_changed_installment_label():
    instance = card()
    tx = imported(k=7, n=10)
    instance["invoice_cycles"]["2026-10-29"] = {
        "items": [{
            "id": "imported", "name": "Notebook", "date": tx["date"],
            "purchase_cents": 10000, "category_name": "Compras",
            "category_color": None, "installment_label": "1/10",
        }],
        "paid_cents": 4000, "paid_at": "2026-10-20",
    }
    state = invoice_state(instance, [tx], "2026-10-29")
    assert len(state["items"]) == 1
    assert state["total_cents"] == 10000
    assert state["paid_cents"] == 4000
    assert commitment(instance, [tx], "2026-10-29") == (6000, 30000, 36000)


@pytest.mark.parametrize("n", [2, 3, 7, 10, 12, 120])
def test_each_k_has_exact_remaining_sum(n):
    tx = imported(k=1, n=n, total=D("10000.01"))
    all_parts = [installment_portion(tx, i) for i in range(n)]
    for k in range(1, n + 1):
        tx["current_installment"] = k
        result = occurrences(card(), tx)
        assert len(result) == n - k + 1
        assert sum(cents for _, cents, _ in result) == sum(
            int(part * 100) for part in all_parts[k - 1:]
        )


@pytest.mark.parametrize("invalid", [0, -1, 11])
def test_invalid_k_n_is_rejected(invalid):
    tx = imported(k=invalid)
    with pytest.raises(ValueError):
        remaining_installment_indices(tx)
