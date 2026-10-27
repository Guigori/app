"""FIN-07/08 full synthetic ledger parity against the exact TS fixture.

Currency and daily events are asserted in cents. No real Firestore traffic.
"""
import asyncio
import json
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from finnos.lib.competency import monthly_competency
from finnos.lib.money import cents
from finnos.lib.stats import balance_effects
from finnos.lib.subscription_projection import planned_subscriptions
from finnos.routers import analytics


FILE = Path(__file__).resolve().parents[2] / "fixtures" / "finance-ledger-parity.json"
F = json.loads(FILE.read_text(encoding="utf-8"))


def records():
    ledger = {"invoice_adjustments": {}, "invoice_refunds": {}}
    for event in F["credit_events"]:
        kind = "invoice_refunds" if event["kind"] == "bank_refund" else "invoice_adjustments"
        amount = "refund_cents" if kind == "invoice_refunds" else "credit_cents"
        ledger[kind].setdefault(event["cycle"], []).append({
            "id": event["id"], "purchase_id": event["purchase_id"],
            "date": event["date"], amount: cents(event["value"]),
        })
    card = {"id": "card", **ledger}
    return F["transactions"], [card], [F["subscription"]]


def test_shared_monthly_competency_bank_ledger_and_future_subscription():
    txs, cards, subs = records()
    value = monthly_competency(txs, cards, F["month"])
    expected = F["expected"]
    for key in ("income", "expense", "net"):
        assert cents(value[key]) == cents(expected[key])
    assert value["by_category"]["shopping"] == Decimal("-150")
    assert value["by_category"]["rent"] == Decimal("1000")
    balances = {account["id"]: cents(account["initial_balance"])
                for account in F["accounts"]}
    for tx in txs:
        for account, amount in balance_effects(tx, F["today"]):
            balances[account] += cents(amount)
    assert balances == {key: cents(value) for key, value in expected["balance_by_account"].items()}
    assert sum(balances.values()) == cents(expected["total_balance"])
    forecast = planned_subscriptions(subs, txs, F["month"], F["today"])
    assert len(forecast) == 1
    assert forecast[0][1].isoformat() == "2026-10-29"
    assert cents(forecast[0][0]["value"]) == cents(expected["projected_expense"])


def test_flow_breakdown_preserves_net_refunds_without_negative_bars(monkeypatch):
    txs, cards, subs = records()
    categories = [
        {"id": "rent", "name": "Moradia", "color": "#070F52", "icon": "home"},
        {"id": "shopping", "name": "Compras", "color": "#070F52", "icon": "bag"},
    ]
    docs = {"transactions": txs, "cards": cards, "subscriptions": subs,
            "categories": categories}

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, maximum):
            return self.rows[:maximum]

    class Collection:
        def __init__(self, name):
            self.name = name

        def find(self, query):
            assert query["user_id"] == "owner"
            return Cursor(docs[self.name])

    monkeypatch.setattr(analytics, "db", SimpleNamespace(**{
        kind: Collection(kind) for kind in docs
    }))
    monkeypatch.setattr(analytics, "today_iso", lambda: F["today"])
    result = asyncio.run(analytics.flow(
        month=F["month"], months=2, from_month=None, to_month=None,
        category_id=None, user={"id": "owner"},
    ))
    assert cents(result.expense) == cents(F["expected"]["expense"])
    assert [(row.category_id, cents(row.total), row.percent)
            for row in result.categories] == [("rent", 100000, 100)]


def test_shared_ledger_calendar_uses_the_same_competency(monkeypatch):
    txs, cards, subs = records()
    docs = {"transactions": txs, "cards": cards, "subscriptions": subs}
    class Cursor:
        def __init__(self, rows): self.rows = rows
        async def to_list(self, maximum): return self.rows
    class Collection:
        def __init__(self, name): self.name = name
        def find(self, query):
            assert query["user_id"] == "owner"
            data = docs[self.name]
            if self.name == "transactions" and "date" in query:
                low, high = query["date"]["$gte"], query["date"]["$lte"]
                data = [tx for tx in data if low <= tx["date"] <= high]
            return Cursor(data)
    monkeypatch.setattr(analytics, "db", SimpleNamespace(**{
        kind: Collection(kind) for kind in docs
    }))
    monkeypatch.setattr(analytics, "today_iso", lambda: F["today"])
    day = asyncio.run(analytics.calendar_month(month=F["month"], user={"id": "owner"}))
    expected = F["expected"]
    assert cents(day.income) == cents(expected["income"])
    assert cents(day.expense) == cents(expected["expense"])
    assert cents(day.net) == cents(expected["net"])
    assert cents(day.projected_expense) == cents(expected["projected_expense"])
    refund = next(entry for entry in day.days if entry.date == "2026-10-26")
    assert cents(refund.expense) == cents(expected["calendar_expense_on_refund_day"])
    assert cents(refund.income) == 0
