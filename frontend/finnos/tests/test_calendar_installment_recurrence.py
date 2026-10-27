"""FIN-03/04/14: calendar places old paid installments in their competency day.

No synthetic due item is presented as an existing transaction. A future
recurring fixed-series occurrence is projected exactly once, and the same
bill's subscription forecast is suppressed.
"""
import asyncio
from decimal import Decimal
from types import SimpleNamespace

from finnos.lib.competency import monthly_competency
from finnos.routers import analytics


def test_old_installment_and_recurring_future_bill_match_engine(monkeypatch):
    transactions = [{
        "id": "card-installment", "name": "Compra parcelada",
        "type": "despesa", "date": "2026-08-31",
        "status": "pago", "installment": True,
        "current_installment": 1, "total_installments": 3,
        "value": Decimal("100.00"), "card_id": "card",
        "category_id": "shopping",
    }, {
        "id": "old-fixed", "name": "Netflix",
        "type": "despesa", "date": "2026-09-30",
        "status": "pago", "installment": False,
        "fixed": True, "value": Decimal("49.90"),
        "account_id": "bank", "card_id": None,
        "category_id": "streaming",
    }, {
        "id": "invoice-receipt", "name": "Quitação da fatura",
        "type": "despesa", "date": "2026-10-07",
        "value": Decimal("150"), "status": "pago",
        "invoice_payment": True, "account_id": "bank",
    }]
    cards = [{"id": "card"}]
    subscriptions = [{
        "id": "sub", "name": "Netflix", "value": Decimal("49.90"),
        "next_charge": "2026-10-30", "recurrence": "mensal",
        "active": True, "account_id": "bank", "card_id": None,
        "category_id": "streaming",
    }]

    class Collection:
        def __init__(self, data):
            self.data = data
        def find(self, query):
            assert query["user_id"] == "owner"
            return self
        async def to_list(self, maximum):
            return self.data

    async def revision(uid):
        assert uid == "owner"
        return 5
    async def history(uid, months, requested_cards, expected):
        assert (uid, months, expected) == ("owner", ["2026-10"], 5)
        return transactions

    monkeypatch.setattr(analytics, "db", SimpleNamespace(
        cards=Collection(cards), subscriptions=Collection(subscriptions),
    ))
    monkeypatch.setattr(analytics, "today_iso", lambda: "2026-10-27")
    monkeypatch.setattr(analytics, "finance_revision", revision)
    monkeypatch.setattr(analytics, "read_projection_history", history)

    result = asyncio.run(analytics.calendar_month(
        month="2026-10", user={"id": "owner"},
    ))
    days = {x.date: x for x in result.days}
    assert days["2026-10-31"].expense == Decimal("33.34")
    assert days["2026-10-31"].count == 0
    assert days["2026-10-30"].projected_expense == Decimal("49.90")
    assert days["2026-10-30"].count == 0
    assert days["2026-10-07"].expense == Decimal("0")
    assert result.expense == Decimal("33.34")
    assert result.projected_expense == Decimal("49.90")
    expected = monthly_competency(transactions, cards, "2026-10")
    assert expected["expense"] == result.expense
