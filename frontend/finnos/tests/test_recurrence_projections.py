"""Regression coverage for FIN-03 (duplicate recurring forecasts)."""
from datetime import date
from finnos.lib.recurrence import monthly_projection_sources, projections_in_period


def row(month, amount=1500, *, name="Aluguel", fixed=True, status="pago"):
    return dict(
        id=month, date=f"{month}-10", value=amount, name=name,
        type="despesa", account_id="bank", category_id="rent",
        card_id=None, fixed=fixed, recurrence="mensal" if fixed else None,
        status=status,
    )


def test_three_paid_rows_project_only_one_occurrence():
    txs = [row("2026-01"), row("2026-02"), row("2026-03")]
    result = monthly_projection_sources(txs, "2026-04")
    assert len(result) == 1
    assert result[0][0]["id"] == "2026-03"
    assert result[0][1] == "2026-04-10"


def test_actual_pending_or_paid_row_suppresses_future_projection():
    earlier = row("2026-03")
    for status in ("pago", "pendente", "agendado"):
        assert monthly_projection_sources([earlier, row("2026-04", fixed=False, status=status)], "2026-04") == []


def test_latest_amount_wins_and_independent_series_remain_separate():
    txs = [row("2026-01", 1000), row("2026-03", 1600), row("2026-02", 90, name="Internet")]
    result = monthly_projection_sources(txs, "2026-04")
    assert len(result) == 2
    assert {r[0]["name"]: r[0]["value"] for r in result} == {"Aluguel": 1600, "Internet": 90}


def test_partial_period_and_short_month_are_clamped():
    tx = row("2026-01")
    tx["date"] = "2026-01-31"
    assert projections_in_period([tx], date(2026, 2, 1), date(2026, 2, 28)) == [(tx, date(2026, 2, 28))]
    assert projections_in_period([tx], date(2026, 2, 1), date(2026, 2, 27)) == []


def test_no_projection_for_invoice_payment_or_installments():
    paid = {**row("2026-01"), "invoice_payment": True}
    installment = {**row("2026-02"), "installment": True}
    assert monthly_projection_sources([paid, installment], "2026-04") == []


def test_two_explicit_series_ids_do_not_collapse():
    first = {**row("2026-03"), "recurrence_id": "A"}
    second = {**row("2026-03"), "recurrence_id": "B"}
    assert len(monthly_projection_sources([first, second], "2026-04")) == 2
