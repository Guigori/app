"""The "Saldo" line of the Home chart follows the money in the accounts.

Every case is checked against AccountLedger, the rule behind "Saldo total", so the
chart and the balance card can never disagree.
"""
import pytest
from fastapi import HTTPException

from finnos.lib.account_balances import AccountLedger
from finnos.lib.cash_history import CashHistory
from finnos.lib.money import D

ACCOUNTS = [
    {"id": "itau", "initial_balance": "1000.00"},
    {"id": "nu", "initial_balance": "500.00"},
]


def tx(date, kind, value, account="itau", status="pago", **extra):
    return {"id": f"{date}-{kind}-{value}", "date": date, "type": kind, "value": D(value),
            "account_id": account, "status": status, **extra}


HISTORY = [
    tx("2026-09-10", "receita", "300.00"),                        # before October
    tx("2026-10-05", "receita", "5200.00"),                       # salary
    tx("2026-10-06", "despesa", "120.00"),                        # debit purchase
    tx("2026-10-07", "despesa", "999.00", card_id="card"),        # card purchase: invoice later
    tx("2026-10-08", "despesa", "450.00", invoice_payment=True),  # invoice paid from the account
    tx("2026-10-09", "transferencia", "200.00", to_account_id="nu"),  # between own accounts
    tx("2026-10-20", "despesa", "80.00", status="pendente"),     # not paid: never moves money
    tx("2026-11-03", "despesa", "50.00"),                         # after October
]


def ledger_total(today, rows=HISTORY):
    ledger = AccountLedger(ACCOUNTS, today)
    for row in rows:
        ledger.add(row)
    return ledger.total_balance


def history(month, today, rows=HISTORY):
    h = CashHistory(ACCOUNTS, month, today)
    for row in rows:
        h.add(row)
    return h.result()


def test_every_day_of_a_past_month_matches_the_account_balance_of_that_day():
    result = history("2026-10", "2026-11-10")
    assert result["opening_balance"] == ledger_total("2026-09-30") == D("1800.00")
    assert len(result["days"]) == 31
    for day in result["days"]:
        assert day["balance"] == ledger_total(day["date"]), day["date"]
    # Ends October at the real end-of-October balance, not at today's balance.
    assert result["balance"] == ledger_total("2026-10-31") != ledger_total("2026-11-10")


def test_card_purchases_wait_for_the_invoice_and_transfers_cancel_out():
    days = {d["date"]: d["balance"] for d in history("2026-10", "2026-11-10")["days"]}
    assert days["2026-10-07"] == days["2026-10-06"]                     # card purchase: no change
    assert days["2026-10-08"] == days["2026-10-07"] - D("450.00")       # invoice payment: money leaves
    assert days["2026-10-09"] == days["2026-10-08"]                     # own transfer: total unchanged
    assert days["2026-10-20"] == days["2026-10-19"]                     # pending: never counts


def test_this_month_stops_today_and_ends_on_saldo_total():
    result = history("2026-11", "2026-11-10")
    assert [d["date"] for d in result["days"]][-1] == "2026-11-10"
    assert result["balance"] == ledger_total("2026-11-10")


def test_a_future_month_starts_from_todays_balance_with_no_real_days():
    result = history("2026-12", "2026-11-10")
    assert result["days"] == []
    assert result["opening_balance"] == result["balance"] == ledger_total("2026-11-10")


def test_account_installments_move_the_balance_on_each_installment_date():
    rows = [tx("2026-09-15", "despesa", "300.00", installment=True, total_installments=3, current_installment=1)]
    result = history("2026-10", "2026-11-10", rows)
    for day in result["days"]:
        assert day["balance"] == ledger_total(day["date"], rows), day["date"]
    days = {d["date"]: d["balance"] for d in result["days"]}
    assert days["2026-10-15"] == days["2026-10-14"] - D("100.00")


def test_an_entry_on_an_unknown_account_is_never_a_partial_balance():
    with pytest.raises(HTTPException) as err:
        history("2026-10", "2026-11-10", [tx("2026-10-05", "receita", "10.00", account="sumiu")])
    assert err.value.status_code == 409


def test_the_streamed_history_reads_every_page_and_ends_on_the_ledger_total(monkeypatch):
    """Same paged Firestore read as the balances; rows stored in cents, like production."""
    import asyncio

    from finnos.lib.account_balances import finance_revision, stream_account_balances, stream_cash_history
    from finnos.lib import db as store
    from finnos.tests.test_account_balances_streaming import account, paid, setup

    rows = [paid(f"tx-{i:04d}", "receita", 100, date=f"2026-10-{1 + i % 28:02d}") for i in range(700)]
    rows += [paid("card", "despesa", 99900, card_id="credit", date="2026-10-10"),
             paid("bill", "despesa", 5000, invoice_payment=True, date="2026-10-12")]
    metrics, token = setup(monkeypatch, rows)
    try:
        opening = [account("bank", "100.00")]
        revision = asyncio.run(finance_revision("synthetic-uid"))
        result = asyncio.run(stream_cash_history("synthetic-uid", opening, "2026-10", "2026-10-27", revision))
        ledger = asyncio.run(stream_account_balances("synthetic-uid", opening, "2026-10-27", revision))
        assert metrics["pages"] >= 6
        assert result["days"][-1]["date"] == "2026-10-27"
        assert result["balance"] == ledger.total_balance
        assert result["opening_balance"] == D("100.00")
    finally:
        store.active_uid.reset(token)


def test_the_history_refuses_a_concurrent_write(monkeypatch):
    import asyncio

    from finnos.lib.account_balances import stream_cash_history
    from finnos.lib import db as store
    from finnos.tests.test_account_balances_streaming import account, paid, setup

    metrics, token = setup(monkeypatch, [paid("a", "receita", 100)])
    try:
        with pytest.raises(HTTPException) as err:
            asyncio.run(stream_cash_history("synthetic-uid", [account("bank")], "2026-10", "2026-10-27", 6))
        assert err.value.status_code == 409
    finally:
        store.active_uid.reset(token)
