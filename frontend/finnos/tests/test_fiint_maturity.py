"""FIINT D1..12: accountable signals from exact canonical financial history."""
from datetime import date

from finnos.lib.fiint import fiint_months, fiint_report


def months(month="2026-10"):
    from finnos.lib.stats import add_months
    return [
        {
            "month": add_months(month, offset), "income": 0.0,
            "expense": 0.0, "net": 0.0, "count": 0,
        }
        for offset in range(-11, 1)
    ]


def build(rows, **changes):
    base = {
        "today": date(2026, 10, 28), "monthly": rows,
        "accounts": [], "categories": [], "budget_cycles": [],
        "subscriptions": [],
    }
    base.update(changes)
    return fiint_report(**base)


def test_no_data_is_d1_not_fictitious_financial_health():
    result = build(months())
    assert result["score"] == 0
    assert result["maturity_month"] == 1
    assert result["stage"] == "D1"
    assert result["months_observed"] == 0
    assert result["is_financial_health_score"] is False
    assert result["writes_data"] is False
    assert len(result["monthly_history"]) == 12


def test_fiint_scores_are_transparent_and_capped_with_real_history():
    rows = months()
    for row in rows[-3:]:
        row.update(count=1, income=1000.20, expense=300.10, net=700.10)
    result = build(
        rows,
        accounts=[{"active": True, "id": "bank"}],
        categories=[{"id": "costs"}],
        subscriptions=[{"active": True, "id": "rent"}],
        budget_cycles=[{
            "start_date": "2026-10-01", "end_date": "2026-10-31",
            "closed_at": None,
        }],
    )
    assert result["score"] == 100
    assert len([x for x in result["criteria"] if x["completed"]]) == 6
    assert result["months_observed"] == 3
    assert result["history_span_months"] == 3
    assert result["stage"] == "M3"
    assert result["monthly_history"][-1]["income"] == 1000.20
    assert result["monthly_history"][-1]["net"] == 700.10


def test_savings_is_not_guessed_and_no_false_entries_from_future_plans():
    rows = months()
    rows[0].update(count=1, income=0, expense=500, net=-500)
    result = build(rows, subscriptions=[{"active": False}])
    assert result["score"] == 0
    assert result["months_observed"] == 1
    assert result["maturity_month"] == 12
    assert result["history_start"] == "2025-11"
    assert result["monthly_history"][0]["expense"] == 500
    assert result["data_quality"]["has_open_budget"] is False


def test_month_window_is_exactly_twelve_chronological_periods():
    values = fiint_months(date(2026, 1, 5))
    assert values[0] == "2025-02"
    assert values[-1] == "2026-01"
    assert len(set(values)) == 12
