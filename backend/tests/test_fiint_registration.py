"""FIINT text draft: conservative parsing and confirmation contract."""
from datetime import date

from lib.fiint.registration import interpret

TODAY = date(2026, 10, 14)
ACCOUNTS = [{"id": "n", "name": "Nubank"}, {"id": "i", "name": "Inter"}]
CATEGORIES = [{"id": "food", "name": "Alimentação"}]


def test_expense_preview_does_not_save_or_assume_confirmation():
    result = interpret("Gastei R$ 48,50 na padaria hoje pelo Nubank",
                       today=TODAY, accounts=ACCOUNTS, categories=CATEGORIES)
    assert result["type"] == "despesa"
    assert result["value"] == 48.5
    assert result["category_id"] == "food"
    assert result["account_id"] == "n"
    assert result["date"] == "2026-10-14"
    assert result["requires_confirmation"] is True


def test_transfer_requires_destination_confirmation():
    result = interpret("Transferi R$ 200 do Nubank para o Inter",
                       today=TODAY, accounts=ACCOUNTS, categories=CATEGORIES)
    assert result["type"] == "transferencia"
    assert result["to_account_id"] is None
    assert "to_account_id" in result["missing_fields"]


def test_ambiguous_text_does_not_invent_type_or_account():
    result = interpret("R$ 25 ontem", today=TODAY,
                       accounts=ACCOUNTS, categories=CATEGORIES)
    assert result["type"] is None
    assert result["account_id"] is None
    assert result["date"] is None
    assert result["requires_confirmation"]
