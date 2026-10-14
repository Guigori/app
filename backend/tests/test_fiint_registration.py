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
    assert result["account_id"] == "n"
    assert result["to_account_id"] == "i"
    assert "to_account_id" not in result["missing_fields"]


def test_ambiguous_text_does_not_invent_type_or_account():
    result = interpret("R$ 25 ontem", today=TODAY,
                       accounts=ACCOUNTS, categories=CATEGORIES)
    assert result["type"] is None
    assert result["account_id"] is None
    assert result["date"] == "2026-10-13"
    assert result["requires_confirmation"]


def test_installments_and_yesterday():
    result = interpret("Comprei R$ 1.584,90 em 5x ontem no Nubank",
                       today=TODAY, accounts=ACCOUNTS, categories=CATEGORIES)
    assert result["value"] == 1584.90
    assert result["installment"] is True
    assert result["total_installments"] == 5
    assert result["date"] == "2026-10-13"


def test_income_not_installment():
    result = interpret("Recebi R$ 3.100,00 em 5x hoje no Inter",
                       today=TODAY, accounts=ACCOUNTS, categories=CATEGORIES)
    assert result["type"] == "receita"
    assert result["value"] == 3100.0
    assert result["installment"] is False


def test_ambiguous_transfer_keeps_accounts_unset():
    result = interpret("Transferi R$ 100 Nubank Inter",
                       today=TODAY, accounts=ACCOUNTS, categories=CATEGORIES)
    assert result["account_id"] is None
    assert result["to_account_id"] is None
