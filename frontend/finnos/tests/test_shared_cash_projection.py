"""FIN-07/08/13/14: shared Radar/Simulation future cash in exact cents."""
from datetime import date
from decimal import Decimal

import pytest

from finnos.lib.cash_projection import project_scheduled_cash


def tx(identifier, value, *, when="2026-11-01", kind="despesa",
       status="agendado", **fields):
    return {
        "id": identifier, "name": identifier, "type": kind,
        "value": Decimal(value), "date": when,
        "status": status, "account_id": "bank",
        "card_id": None, **fields,
    }


def test_paid_card_purchase_and_invoice_payment_are_not_double_counted():
    rows = [
        tx("purchase", "300.00")
    ]
    # Card purchases never directly debit bank balances.
    rows[0]["card_id"] = "card"
    rows.append(tx("settled", "300.00", invoice_payment=True))
    rows.append(tx("scheduled", "40.05"))
    result = project_scheduled_cash(
        rows, 10000, date(2026, 10, 28), date(2026, 11, 28)
    )
    assert result["projected_cents"] == 5995
    assert result["event_count"] == 1


def test_fixed_salary_and_explicit_occurrence_are_not_duplicated():
    fixed = tx("salary", "2000.00", when="2026-09-05",
               kind="receita", status="pago",
               fixed=True, recurrence="mensal", recurrence_id="salary-1")
    current = tx("salary-10", "2100.00", when="2026-10-05",
                 kind="receita", fixed=False, recurrence_id="salary-1")
    # November has a single projection from the last fixed source.
    result = project_scheduled_cash(
        [fixed, current], 0, date(2026, 10, 1), date(2026, 11, 30),
    )
    assert result["daily_deltas_cents"]["2026-10-05"] == 210000
    assert result["daily_deltas_cents"]["2026-11-05"] == 200000
    assert result["projected_cents"] == 410000


def test_installments_and_short_months_use_residual_cent_rules():
    installment = tx(
        "installment", "100.01", when="2026-01-31",
        installment=True, total_installments=3, current_installment=1,
    )
    result = project_scheduled_cash(
        [installment], 0, date(2026, 1, 1), date(2026, 3, 31),
    )
    assert len(result["daily_deltas_cents"]) == 3
    assert set(result["daily_deltas_cents"]) == {
        "2026-01-31", "2026-02-28", "2026-03-31",
    }
    assert result["projected_cents"] == -10001


def test_bank_subscription_forecasts_do_not_duplicate_fixed_bill():
    bill = tx("internet", "79.90", when="2026-09-10", status="pago",
              fixed=True, recurrence="mensal", category_id="services")
    subscription = {
        "id": "sub", "name": "internet", "value": Decimal("79.90"),
        "account_id": "bank", "card_id": None, "category_id": "services",
        "next_charge": "2026-10-10", "recurrence": "mensal", "active": True,
    }
    result = project_scheduled_cash(
        [bill], 20000, date(2026, 10, 1), date(2026, 11, 30),
        [subscription],
    )
    assert result["event_count"] == 2
    assert result["projected_cents"] == 4020


def test_negative_balance_date_and_invalid_windows():
    result = project_scheduled_cash([
        tx("rent", "101.00", when="2026-11-03"),
        tx("salary", "40.00", when="2026-11-07", kind="receita"),
    ], 10000, date(2026, 10, 28), date(2026, 11, 28))
    assert result["first_negative_date"] == "2026-11-03"
    assert result["projected_cents"] == 3900
    with pytest.raises(ValueError):
        project_scheduled_cash([], 0, date(2026, 11, 1), date(2026, 10, 1))
