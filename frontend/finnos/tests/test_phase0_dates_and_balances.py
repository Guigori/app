from datetime import datetime
from unittest.mock import patch

from finnos.lib.dates import today_iso
from finnos.lib.stats import balance_effects


def test_future_paid_expense_does_not_change_realized_balance():
    tx = {"type": "despesa", "status": "pago", "date": "2026-12-01", "value": 200, "account_id": "acc", "card_id": None}
    assert balance_effects(tx, "2026-10-25") == []


def test_current_paid_expense_affects_realized_balance():
    tx = {"type": "despesa", "status": "pago", "date": "2026-10-25", "value": 200, "account_id": "acc", "card_id": None}
    assert balance_effects(tx, "2026-10-25") == [("acc", -200)]


def test_default_timezone_is_sao_paulo(monkeypatch):
    monkeypatch.delenv("APP_TZ", raising=False)
    assert today_iso() == datetime.now(__import__("zoneinfo").ZoneInfo("America/Sao_Paulo")).strftime("%Y-%m-%d")
