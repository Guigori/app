"""FIN-08/14: calendar and month competency use the same refund semantics.

Synthetic UID-scoped query mocks only; no Firestore modifications.
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.lib.competency import monthly_competency
from finnos.routers import analytics, transactions


class Query:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, count):
        assert count in (200, 5000, 20000)
        return self.rows


class Collection:
    def __init__(self, records, kind):
        self.records = records
        self.kind = kind

    def find(self, query):
        assert query["user_id"] == "uid"
        rows = self.records[self.kind]
        if self.kind == "transactions" and "date" in query:
            rng = query["date"]
            rows = [tx for tx in rows if rng["$gte"] <= tx["date"] <= rng["$lte"]]
        return Query(rows)


def scenario():
    txs = [
        {"id": "old", "type": "despesa", "date": "2026-09-20",
         "status": "pago", "value": 300, "card_id": "card",
         "category_id": "groceries"},
        {"id": "salary", "type": "receita", "date": "2026-10-05",
         "status": "pago", "value": 1000, "account_id": "bank"},
        {"id": "out", "type": "despesa", "date": "2026-10-10",
         "status": "pago", "value": 50, "account_id": "bank"},
        {"id": "invoice-payment", "type": "despesa", "date": "2026-10-07",
         "status": "pago", "value": 300, "account_id": "bank",
         "invoice_payment": True},
        {"id": "refund", "type": "receita", "date": "2026-10-26",
         "status": "pago", "value": 100, "account_id": "bank",
         "invoice_refund": True},
    ]
    cards = [{
        "id": "card",
        "invoice_refunds": {"2026-09-29": [{
            "id": "refund", "purchase_id": "old",
            "date": "2026-10-26", "refund_cents": 10000,
        }]},
        "invoice_adjustments": {"2026-09-29": [{
            "id": "credit", "purchase_id": "old",
            "date": "2026-10-25", "credit_cents": 2500,
        }]},
    }]
    return {"transactions": txs, "cards": cards}


def test_calendar_refunds_reverse_spending_without_increasing_income(monkeypatch):
    rows = scenario()
    monkeypatch.setattr(analytics, "db", SimpleNamespace(**{
        kind: Collection(rows, kind) for kind in rows
    }))
    output = asyncio.run(analytics.calendar_month(month="2026-10", user={"id": "uid"}))
    assert output.income == 1000
    assert output.expense == -75
    assert output.net == 1075
    days = {day.date: day for day in output.days}
    assert days["2026-10-26"].income == 0
    assert days["2026-10-26"].expense == -100
    assert days["2026-10-26"].count == 1
    assert days["2026-10-25"].expense == -25
    assert days["2026-10-25"].count == 1
    assert days["2026-10-07"].expense == 0
    assert days["2026-10-05"].income == 1000
    month = monthly_competency(rows["transactions"], rows["cards"], "2026-10")
    assert month["income"] == output.income
    assert month["expense"] == output.expense


@pytest.mark.parametrize("source", [
    "manual", "ios_shortcut", "bank_notification", "import", "system",
])
def test_supported_transaction_provenance_is_normalized(source):
    assert transactions.normalized_operation_source(source) == source


@pytest.mark.parametrize("source", ["fake-bank", "admin", "  manual", "MANUAL", "unknown"])
def test_unauthorized_transaction_provenance_is_rejected(source):
    with pytest.raises(HTTPException) as error:
        transactions.normalized_operation_source(source)
    assert error.value.status_code == 422
