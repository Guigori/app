"""Regression tests for invoice payment arithmetic (no Firebase credentials needed)."""
import pytest
from finnos.lib.invoice_payments import allocate_payment, invoice_balance, to_cents


def test_money_is_exact():
    assert to_cents("156.78") == 15678
    assert to_cents("0.01") == 1
    with pytest.raises(ValueError):
        to_cents("0.001")
    with pytest.raises(ValueError):
        to_cents("NaN")


def test_partial_then_full_payment():
    first = allocate_payment(10001, [], 4000)
    assert first == {
        "payment_cents": 4000, "paid_cents": 4000,
        "outstanding_cents": 6001, "settled": False,
    }
    second = allocate_payment(10001, [4000])
    assert second == {
        "payment_cents": 6001, "paid_cents": 10001,
        "outstanding_cents": 0, "settled": True,
    }
    assert invoice_balance(10001, [4000, 6001]) == (10001, 0)


@pytest.mark.parametrize("total,history,requested", [
    (1000, [], 0), (1000, [], -1), (1000, [], 1001),
    (1000, [1000], 1), (1000, [1001], 1),
    (1000, [-1], 1), (1000, [], True),
])
def test_invalid_payment_rejected(total, history, requested):
    with pytest.raises(ValueError):
        allocate_payment(total, history, requested)
