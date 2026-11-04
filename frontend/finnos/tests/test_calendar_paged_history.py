"""FIN-08/14: one paged calendar history without truncating month >5,000.

Router receives the bounded result from the UID-scoped reader; test also
asserts the old date-scoped .to_list(5000)/20k scan is never executed.
"""
import asyncio
from decimal import Decimal
from types import SimpleNamespace

from finnos.routers import analytics


def test_large_calendar_month_and_historical_subscription_are_complete(monkeypatch):
    today = "2026-10-27"
    entries = [{
        "id": f"income-{i:05d}", "name": "Entrada",
        "date": "2026-10-05", "type": "receita", "status": "pago",
        "value": Decimal("0.01"), "account_id": "bank", "card_id": None,
        "installment": False,
    } for i in range(5009)]
    entries.append({
        "id": "fixed-legacy", "name": "Streaming", "type": "despesa",
        "date": "2025-01-10", "status": "pago",
        "value": Decimal("49.90"), "account_id": "bank",
        "card_id": None, "category_id": "subscriptions",
        "fixed": True, "installment": False,
    })
    subscriptions = [{
        "id": "sub", "name": "Streaming", "value": Decimal("49.90"),
        "next_charge": "2026-10-29", "recurrence": "mensal",
        "active": True, "account_id": "bank",
        "card_id": None, "category_id": "subscriptions",
    }]
    visited = []

    class Collection:
        def __init__(self, kind, rows):
            self.kind, self.rows = kind, rows

        def find(self, query):
            assert query["user_id"] == "owner"
            visited.append(self.kind)
            return self

        async def to_list(self, max_count):
            assert max_count in (200, 500)
            return self.rows

    async def revision(uid):
        assert uid == "owner"
        return 19

    async def history(uid, months, cards, expected):
        assert (uid, months, expected) == ("owner", ["2026-10"], 19)
        visited.append("history")
        return entries

    monkeypatch.setattr(analytics, "db", SimpleNamespace(
        cards=Collection("cards", []),
        subscriptions=Collection("subscriptions", subscriptions),
    ))
    monkeypatch.setattr(analytics, "today_iso", lambda: today)
    monkeypatch.setattr(analytics, "finance_revision", revision)
    monkeypatch.setattr(analytics, "read_projection_history", history)
    result = asyncio.run(
        analytics.calendar_month(month="2026-10", user={"id": "owner"})
    )
    day = next(x for x in result.days if x.date == "2026-10-05")
    assert day.count == 5009
    assert day.income == Decimal("50.09")
    assert result.income == Decimal("50.09")
    assert result.projected_expense == 0
    assert visited == ["cards", "subscriptions", "history"]
