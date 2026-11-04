from datetime import datetime, timezone

from finnos.lib.dates import today_iso
from finnos.lib.stats import balance_effects, paid_future_is_inconsistent
from finnos.lib.invoices import invoice_state, commitment


def test_future_paid_expense_does_not_change_realized_balance():
    tx = {"type": "despesa", "status": "pago", "date": "2026-12-01", "value": 200, "account_id": "acc", "card_id": None}
    assert balance_effects(tx, "2026-10-25") == []


def test_current_paid_expense_affects_realized_balance():
    tx = {"type": "despesa", "status": "pago", "date": "2026-10-25", "value": 200, "account_id": "acc", "card_id": None}
    assert balance_effects(tx, "2026-10-25") == [("acc", -200)]


def test_default_timezone_is_sao_paulo(monkeypatch):
    monkeypatch.delenv("APP_TZ", raising=False)
    assert today_iso() == datetime.now(__import__("zoneinfo").ZoneInfo("America/Sao_Paulo")).strftime("%Y-%m-%d")


def test_future_paid_income_does_not_change_balance():
    tx = {"type": "receita", "status": "pago", "date": "2026-12-01", "value": 150, "account_id": "acc", "card_id": None}
    assert balance_effects(tx, "2026-10-25") == []


def test_pending_expense_does_not_change_balance():
    tx = {"type": "despesa", "status": "pendente", "date": "2026-10-24", "value": 150, "account_id": "acc", "card_id": None}
    assert balance_effects(tx, "2026-10-25") == []


def test_paid_transfer_affects_both_accounts():
    tx = {"type": "transferencia", "status": "pago", "date": "2026-10-24", "value": 150, "account_id": "a", "to_account_id": "b", "card_id": None}
    assert balance_effects(tx, "2026-10-25") == [("a", -150), ("b", 150)]


def test_invoice_payment_does_not_count_as_credit_purchase():
    card = {"id": "card", "name": "Card", "closing_day": 29, "due_day": 7, "invoice_cycles": {}}
    payment = {"id": "payment", "type": "despesa", "card_id": None, "invoice_payment": True, "date": "2026-10-20", "value": 100}
    assert commitment(card, [payment], "2026-10-29") == (0, 0, 0)


def test_future_paid_input_must_be_rejected_not_silently_reclassified():
    assert paid_future_is_inconsistent("pago", "2026-12-01", "2026-10-26")
    assert not paid_future_is_inconsistent("agendado", "2026-12-01", "2026-10-26")
    assert not paid_future_is_inconsistent("pendente", "2026-12-01", "2026-10-26")
    assert not paid_future_is_inconsistent("pago", "2026-10-26", "2026-10-26")
    assert not paid_future_is_inconsistent("pago", "2026-10-25", "2026-10-26")
