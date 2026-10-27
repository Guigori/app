"""FIN-13: subscription projections are read-only, deduplicated and calendar-safe."""
import asyncio
from datetime import date
from types import SimpleNamespace
from decimal import Decimal

from finnos.lib.subscription_projection import (
    subscription_occurrence, planned_subscriptions,
    planned_subscriptions_in_period,
)
from finnos.routers import analytics


def sub(**extra):
    return {
        "id": "sub", "name": "Netflix", "active": True,
        "value": Decimal("49.90"), "next_charge": "2026-01-31",
        "recurrence": "mensal", "account_id": "bank",
        "card_id": None, "category_id": "streaming",
        **extra,
    }


def test_february_clamping_does_not_change_subscription_anchor():
    subscription = sub()
    assert subscription_occurrence(subscription, "2026-01") == date(2026, 1, 31)
    assert subscription_occurrence(subscription, "2026-02") == date(2026, 2, 28)
    assert subscription_occurrence(subscription, "2026-03") == date(2026, 3, 31)
    assert subscription["next_charge"] == "2026-01-31"
    assert planned_subscriptions([subscription], [], "2026-02", "2026-02-20")[0][1] == date(2026, 2, 28)
    assert planned_subscriptions([subscription], [], "2026-02", "2026-03-01") == []


def test_annual_billing_occurs_only_on_anniversary_and_in_active_window():
    annual = sub(recurrence="anual", next_charge="2026-02-28")
    assert subscription_occurrence(annual, "2026-02") == date(2026, 2, 28)
    assert subscription_occurrence(annual, "2026-03") is None
    assert subscription_occurrence(annual, "2027-02") == date(2027, 2, 28)
    assert planned_subscriptions([annual], [], "2026-02", "2026-03-01") == []
    assert subscription_occurrence(sub(active=False), "2026-02") is None


def test_explicit_transaction_suppresses_forecast_and_fixed_series_owns_future():
    matching = {
        "id": "tx", "name": "NETFLIX", "type": "despesa",
        "date": "2026-02-28", "status": "agendado",
        "value": Decimal("49.90"), "card_id": None,
        "account_id": "bank", "category_id": "streaming",
    }
    assert planned_subscriptions([sub()], [matching], "2026-02", "2026-02-01") == []
    assert len(planned_subscriptions([sub()], [matching], "2026-03", "2026-03-01")) == 1
    matching["fixed"] = True
    assert planned_subscriptions([sub()], [matching], "2026-03", "2026-03-01") == []


def test_future_credit_card_subscription_not_double_counted_as_cash_spent():
    card_sub = sub(card_id="card")
    bill = {
        "type": "despesa", "name": "Netflix",
        "date": "2026-02-28", "card_id": "card",
        "account_id": "bank", "category_id": "streaming",
        "value": Decimal("49.90"), "status": "pago",
    }
    assert planned_subscriptions([card_sub], [bill], "2026-02", "2026-02-01") == []


def test_arbitrary_period_includes_only_future_unmatched_months():
    items = planned_subscriptions_in_period(
        [sub()], [], date(2026, 1, 20), date(2026, 4, 4), "2026-02-15",
    )
    assert [date.isoformat() for _, date in items] == [
        "2026-02-28", "2026-03-31",
    ]


def test_flow_totals_include_subscription_only_as_future_plan(monkeypatch):
    docs = {
        "transactions": [{
            "id": "salary", "name": "Salário", "type": "receita",
            "status": "pago", "date": "2026-10-05", "value": 2500,
            "account_id": "bank",
        }],
        "cards": [],
        "categories": [],
        "subscriptions": [sub(next_charge="2026-11-28")],
    }

    class Cursor:
        def __init__(self, rows): self.rows = rows
        async def to_list(self, limit): return self.rows

    class Coll:
        def __init__(self, kind): self.kind = kind
        def find(self, query):
            assert query["user_id"] == "owner"
            return Cursor(docs[self.kind])

    monkeypatch.setattr(analytics, "db", SimpleNamespace(**{
        name: Coll(name) for name in docs
    }))
    monkeypatch.setattr(analytics, "today_iso", lambda: "2026-10-26")
    async def revision(uid):
        assert uid == "owner"
        return 1
    async def history(uid, months, selected_cards, expected):
        assert (uid, expected) == ("owner", 1)
        return docs["transactions"]
    monkeypatch.setattr(analytics, "finance_revision", revision)
    monkeypatch.setattr(analytics, "read_projection_history", history)
    result = asyncio.run(analytics.flow(month="2026-10", months=2,
                                        from_month=None, to_month=None,
                                        category_id=None, user={"id": "owner"}))
    november = next(p for p in result.series if p.month == "2026-11")
    assert november.projected_expense == Decimal("49.90")
    assert november.expense == 0
    assert result.expense == 0



def test_calendar_subscription_forecast_is_not_a_paid_purchase(monkeypatch):
    docs = {
        "transactions": [{
            "id": "salary", "name": "Salário", "type": "receita",
            "status": "pago", "date": "2026-10-05", "value": 2500,
            "account_id": "bank",
        }],
        "cards": [], "subscriptions": [sub(next_charge="2026-10-29")],
    }
    class Cursor:
        def __init__(self, rows): self.rows = rows
        async def to_list(self, max_count): return self.rows
    class Coll:
        def __init__(self, name): self.name = name
        def find(self, query):
            assert query["user_id"] == "owner"
            return Cursor(docs[self.name])

    monkeypatch.setattr(analytics, "db", SimpleNamespace(**{
        name: Coll(name) for name in docs
    }))
    monkeypatch.setattr(analytics, "today_iso", lambda: "2026-10-26")
    calendar = asyncio.run(analytics.calendar_month(month="2026-10", user={"id": "owner"}))
    day = next(item for item in calendar.days if item.date == "2026-10-29")
    assert day.count == 0
    assert day.income == 0
    assert day.expense == 0
    assert day.projected_expense == Decimal("49.90")
    assert calendar.projected_expense == Decimal("49.90")
    assert calendar.expense == 0

    docs["transactions"].append({
        "id": "scheduled", "name": "Netflix",
        "type": "despesa", "status": "agendado",
        "date": "2026-10-29", "value": 49.90, "account_id": "bank",
        "category_id": "streaming", "card_id": None,
    })
    calendar = asyncio.run(analytics.calendar_month(month="2026-10", user={"id": "owner"}))
    day = next(item for item in calendar.days if item.date == "2026-10-29")
    assert day.count == 1
    assert calendar.projected_expense == Decimal("49.90")



def test_subscription_income_ratio_excludes_bank_refund_receipts(monkeypatch):
    from finnos.routers import subscriptions as router
    collections = {
        "subscriptions": [{
            "id": "sub", "name": "Assinatura", "value": 10,
            "recurrence": "mensal", "next_charge": "2026-10-30",
            "account_id": "bank", "category_id": None,
            "card_id": None, "active": True,
        }],
        "transactions": [
            {"id": "salary", "value": 100, "type": "receita",
             "date": "2026-10-05", "status": "pago"},
            {"id": "refund", "value": 100, "type": "receita",
             "date": "2026-10-26", "status": "pago",
             "invoice_refund": True},
        ],
    }
    class Cursor:
        def __init__(self, rows): self.rows = rows
        async def to_list(self, count): return self.rows
    class Collection:
        def __init__(self, name): self.name = name
        def find(self, query):
            assert query["user_id"] == "owner"
            return Cursor(collections[self.name])
    monkeypatch.setattr(router, "db", SimpleNamespace(**{
        key: Collection(key) for key in collections
    }))
    monkeypatch.setattr(router, "today_iso", lambda: "2026-10-26")
    async def maps(uid):
        return {"bank": {"name": "Conta"}}, {}, {}
    monkeypatch.setattr(router, "_maps", maps)
    result = asyncio.run(router.list_subscriptions(user={"id": "owner"}))
    assert result.monthly_total == 10
    assert result.income_percent == 10
