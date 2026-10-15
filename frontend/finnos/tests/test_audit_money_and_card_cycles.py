"""Money and card date regressions following the FINNOS codebase audit."""
from datetime import date

import pytest

from finnos.lib.money import installment_portion
from finnos.lib.cards import cycle_bounds, due_date
from finnos.lib.invoices import occurrences


@pytest.mark.parametrize("total,count,expected", [
    ("100.00", 3, [3333, 3333, 3334]),
    ("0.60", 120, [0] * 60 + [1] * 60),
    ("0.01", 5, [0, 0, 0, 0, 1]),  # readable legacy record, no negative debit
    ("1000.01", 6, [16666, 16667, 16667, 16667, 16667, 16667]),
])
def test_installment_remainders_are_exact_and_nonnegative(total, count, expected):
    pieces = [
        int(installment_portion({"value": total, "total_installments": count}, n) * 100)
        for n in range(count)
    ]
    assert pieces == expected
    assert sum(pieces) == round(float(total) * 100)
    assert all(item >= 0 for item in pieces)


def test_configured_31st_closing_survives_february_and_march():
    assert cycle_bounds(date(2027, 2, 10), 31) == (date(2027, 2, 1), date(2027, 2, 28))
    assert cycle_bounds(date(2027, 3, 1), 31) == (date(2027, 3, 1), date(2027, 3, 31))
    assert due_date(date(2027, 2, 28), 31, 31) == date(2027, 3, 31)


def test_installments_follow_closing_day_not_february_clamp():
    card = {"id": "test-card", "closing_day": 31}
    tx = {
        "id": "purchase", "type": "despesa", "card_id": "test-card",
        "date": "2027-01-05", "installment": True,
        "total_installments": 3, "value": "100.00",
    }
    events = occurrences(card, tx)
    assert [(date, value) for date, value, _ in events] == [
        ("2027-01-31", 3333), ("2027-02-28", 3333), ("2027-03-31", 3334),
    ]


def test_purchase_after_closing_enters_next_cycle():
    card = {"id": "test-card", "closing_day": 20}
    tx = {
        "id": "purchase", "type": "despesa", "card_id": "test-card",
        "date": "2026-10-21", "installment": False, "value": "70.00",
    }
    assert occurrences(card, tx)[0][0] == "2026-11-20"
