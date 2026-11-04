"""AUD-04: one dated installment contract for balance, Fluxo and calendário.

Runs the exact fixture also used by src/lib/local/installmentParity.test.ts, so
API and local mode must agree to the cent. Synthetic data only.
"""
import json
from datetime import date
from pathlib import Path

import pytest

from finnos.lib.cash_projection import project_scheduled_cash
from finnos.lib.money import cents, installment_schedule
from finnos.lib.stats import balance_effects, month_portion
from finnos.routers.analytics import _unpaid_portion

FILE = Path(__file__).resolve().parents[2] / "fixtures" / "finance-installment-schedule-parity.json"
CASES = json.loads(FILE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_schedule_dates_and_indices(case):
    assert [list(item) for item in installment_schedule(case["tx"])] == case["schedule"]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_realized_balance_counts_only_installments_already_dated(case):
    for today, expected in case["realized_cents"].items():
        got = sum(cents(amount) for _, amount in balance_effects(case["tx"], today))
        assert got == expected, (case["id"], today)


@pytest.mark.parametrize("case", [c for c in CASES if "paid_month_cents" in c], ids=lambda c: c["id"])
def test_paid_competency_per_month(case):
    for month, expected in case["paid_month_cents"].items():
        portion = month_portion(case["tx"], month)
        assert (None if portion is None else cents(portion)) == expected, (case["id"], month)


@pytest.mark.parametrize("case", [c for c in CASES if "unpaid_month_cents" in c], ids=lambda c: c["id"])
def test_scheduled_series_projects_each_installment_month(case):
    for month, expected in case["unpaid_month_cents"].items():
        portion = _unpaid_portion(case["tx"], month)
        assert (None if portion is None else cents(portion)) == expected, (case["id"], month)


def test_cash_ledger_adds_future_installments_of_paid_bank_purchase():
    tx = CASES[0]["tx"]
    opening = 100000 + sum(cents(a) for _, a in balance_effects(tx, "2026-11-04"))
    forecast = project_scheduled_cash([tx], opening, date(2026, 11, 4), date(2026, 12, 4))
    # Realized R$ 100 already left; the 20/11 installment is still to come.
    assert opening == 90000
    assert forecast["daily_deltas_cents"] == {"2026-11-20": -10000}
    assert forecast["projected_cents"] == 80000


def test_cash_ledger_does_not_repeat_installment_dated_on_start():
    tx = CASES[0]["tx"]
    opening = 100000 + sum(cents(a) for _, a in balance_effects(tx, "2026-11-20"))
    forecast = project_scheduled_cash([tx], opening, date(2026, 11, 20), date(2026, 12, 20))
    assert opening == 80000
    assert forecast["daily_deltas_cents"] == {"2026-12-20": -10000}


def test_open_invoice_enters_shared_ledger_on_due_date_and_overdue_on_start():
    card = dict(id="card", name="Cartao", closing_day=29, due_day=7, active=True)
    purchase = dict(id="buy", name="Compra", type="despesa", status="pago", value=300,
                    date="2026-10-20", account_id="bank", card_id="card")
    upcoming = project_scheduled_cash([purchase], 10000, date(2026, 11, 4), date(2026, 12, 4), cards=[card])
    assert upcoming["daily_deltas_cents"] == {"2026-11-07": -30000}
    assert upcoming["first_negative_date"] == "2026-11-07"
    overdue = project_scheduled_cash([purchase], 10000, date(2026, 11, 10), date(2026, 12, 10), cards=[card])
    assert overdue["daily_deltas_cents"] == {"2026-11-10": -30000}


def test_paid_invoice_is_not_charged_again():
    card = dict(id="card", name="Cartao", closing_day=29, due_day=7, active=True,
                invoice_cycles={"2026-10-29": dict(paid_cents=30000, items=[])})
    purchase = dict(id="buy", name="Compra", type="despesa", status="pago", value=300,
                    date="2026-10-20", account_id="bank", card_id="card")
    forecast = project_scheduled_cash([purchase], 10000, date(2026, 11, 4), date(2026, 12, 4), cards=[card])
    assert forecast["daily_deltas_cents"] == {}
