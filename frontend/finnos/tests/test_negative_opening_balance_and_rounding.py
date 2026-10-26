"""FIN-10/11 regressions: debt is a valid opening balance; cent rounding is symmetric."""
import asyncio
import json
from pathlib import Path
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from finnos.lib.money import cents, quantize_brl
from finnos.lib.stats import balance_effects, month_portion
from finnos.models.finnos import AccountIn
from finnos.routers import accounts


def test_negative_opening_balance_is_valid_and_preserves_cents():
    result = AccountIn(
        name="Conta com cheque especial",
        initial_balance=Decimal("-500.23"),
    )
    assert result.initial_balance == Decimal("-500.23")
    assert cents(result.initial_balance) == -50023
    with pytest.raises(ValidationError):
        AccountIn(name="Teste", initial_balance="not-money")


@pytest.mark.parametrize("raw,expected", [
    ("0.125", "0.13"),
    ("-0.125", "-0.13"),
    ("4.245", "4.25"),
    ("-4.245", "-4.25"),
    ("2.335", "2.34"),
    ("-2.335", "-2.34"),
    ("0.005", "0.01"),
    ("-0.005", "-0.01"),
    ("0.004", "0.00"),
    ("-0.004", "-0.00"),
])
def test_half_up_is_identical_to_integer_cents(raw, expected):
    amount = quantize_brl(raw)
    assert amount == Decimal(expected)
    assert cents(raw) == cents(amount)


def test_monthly_income_and_realized_cash_use_same_half_up():
    t = {"id": "legacy", "type": "receita", "status": "pago",
         "date": "2026-10-05", "value": "0.125",
         "account_id": "bank", "card_id": None}
    assert month_portion(t, "2026-10") == Decimal("0.13")
    assert balance_effects(t, "2026-10-26") == [("bank", Decimal("0.13"))]
    t["type"] = "despesa"
    assert balance_effects(t, "2026-10-26") == [("bank", Decimal("-0.13"))]


def test_negative_balance_reconciles_payment_and_transfer(monkeypatch):
    docs = [
        {"id": "bank", "user_id": "owner", "name": "Banco", "type": "corrente",
         "initial_balance": Decimal("-500.23")},
        {"id": "other", "user_id": "owner", "name": "Outros", "type": "digital",
         "initial_balance": Decimal("0")},
    ]
    entries = [
        {"type": "receita", "status": "pago", "date": "2026-10-20",
         "value": "200.00", "account_id": "bank", "card_id": None},
        {"type": "transferencia", "status": "pago", "date": "2026-10-21",
         "value": "50.00", "account_id": "bank", "to_account_id": "other",
         "card_id": None},
    ]

    class Query:
        def __init__(self, rows):
            self.rows = rows
        def sort(self, field, direction):
            return self
        async def to_list(self, count):
            return self.rows

    class Collection:
        def __init__(self, rows):
            self.rows = rows
        def find(self, query):
            assert query["user_id"] == "owner"
            return Query(self.rows)

    monkeypatch.setattr(accounts, "db", SimpleNamespace(
        accounts=Collection(docs), transactions=Collection(entries),
    ))
    monkeypatch.setattr(accounts, "today_iso", lambda: "2026-10-26")
    result = asyncio.run(accounts._enriched_accounts("owner"))
    assert result[0].balance == Decimal("-350.23")
    assert result[1].balance == Decimal("50.00")
    assert sum(row.balance for row in result) == Decimal("-300.23")


def test_rounding_parity_with_typescript_fixtures():
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "finance-money-parity.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    for item in fixture["rounding"]:
        assert cents(item["input"]) == item["cents"], item["input"]
        assert cents(quantize_brl(item["input"])) == item["cents"], item["input"]
    for item in fixture["overdraft"]:
        assert (item["opening_cents"] + item["income_cents"] - item["transfer_out_cents"]) == item["expected_cents"]
