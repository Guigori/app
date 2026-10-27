"""FIN-08: Budget V2 must agree with shared competency after card refunds.

No Firestore credentials are used. All data and query results are synthetic,
and read-only calculations never modify the user's records.
"""
import asyncio
from decimal import Decimal
from datetime import date
from types import SimpleNamespace

from finnos.routers import budgets


def tx(identifier, *, kind, value, when, category=None, card=None, **extra):
    return {
        "id": identifier, "name": identifier, "type": kind,
        "status": "pago", "date": when, "value": value,
        "category_id": category, "account_id": "bank", "card_id": card,
        "installment": False, **extra,
    }


def fake_db(monkeypatch, *, transactions, cards, categories, subscriptions=None):
    data = {
        "transactions": transactions, "cards": cards, "categories": categories,
        "subscriptions": subscriptions or [],
    }

    class Find:
        async def to_list(self, maximum):
            assert maximum in (200, 500, 20000)
            return self.items[:maximum]

        def __init__(self, items):
            self.items = items

    class Collection:
        def __init__(self, name):
            self.name = name

        def find(self, query):
            assert query["user_id"] == "owner"
            return Find(data[self.name])

    monkeypatch.setattr(
        budgets, "db",
        SimpleNamespace(**{name: Collection(name) for name in data}),
    )


def test_receipt_from_paid_invoice_is_not_new_budget_income():
    receipt = tx(
        "refund-id", kind="receita", value=100, when="2026-10-26",
        invoice_refund=True,
        invoice_card_id="card", original_purchase_id="old-purchase",
    )
    assert budgets._occurrences_in_cycle(
        receipt, date(2026, 10, 1), date(2026, 10, 31)
    ) == []


def test_budget_cycle_receives_refund_as_compensation_not_salary(monkeypatch):
    purchases = [
        tx("old-purchase", kind="despesa", value=300,
           when="2026-09-20", category="food", card="card"),
        tx("salary", kind="receita", value=3000, when="2026-10-05"),
        tx("refund-id", kind="receita", value=100, when="2026-10-26",
           invoice_refund=True, invoice_card_id="card",
           original_purchase_id="old-purchase"),
    ]
    cards = [{
        "id": "card",
        "invoice_refunds": {"2026-09-29": [{
            "id": "refund-id", "purchase_id": "old-purchase",
            "account_id": "bank", "date": "2026-10-26",
            "refund_cents": 10000,
        }]},
    }]
    fake_db(monkeypatch, transactions=purchases, cards=cards, categories=[
        {"id": "food", "name": "Mercado", "group": "necessidades"},
    ])
    monkeypatch.setattr(budgets, "today_iso", lambda: "2026-10-26")
    cycle = {
        "id": "cycle", "user_id": "owner", "start_date": "2026-10-01",
        "end_date": "2026-10-31", "expected_income": 3000,
        "allocations": [{
            "category_id": "food", "planned": 500,
            "priority": "essencial", "rollover": False,
        }],
    }
    result = asyncio.run(budgets._progress(cycle, "owner"))
    assert result.received_income == 3000
    assert result.committed_income == 0
    assert result.allocations[0].spent == -100
    assert result.allocations[0].available == 600
    assert result.safe_to_spend == 3100


def test_budget_suggestion_uses_refund_adjusted_monthly_expenses(monkeypatch):
    entries = [
        tx("jul", kind="despesa", value=100, when="2026-07-20",
           category="food", card="card"),
        tx("aug", kind="despesa", value=200, when="2026-08-20",
           category="food", card="card"),
        tx("sep", kind="despesa", value=300, when="2026-09-20",
           category="food", card="card"),
        *[
            tx(f"salary-{month}", kind="receita", value=1000,
               when=f"2026-{month}-05")
            for month in ("07", "08", "09")
        ],
        tx("bank-refund", kind="receita", value=50, when="2026-09-25",
           invoice_refund=True, invoice_card_id="card",
           original_purchase_id="aug"),
    ]
    cards = [{
        "id": "card",
        "invoice_adjustments": {"2026-08-29": [{
            "id": "merchant-credit", "purchase_id": "aug",
            "date": "2026-09-24", "credit_cents": 5000,
        }]},
        "invoice_refunds": {"2026-08-29": [{
            "id": "bank-refund", "purchase_id": "aug",
            "account_id": "bank", "date": "2026-09-25",
            "refund_cents": 5000,
        }]},
    }]
    fake_db(monkeypatch, transactions=entries, cards=cards, categories=[
        {"id": "food", "name": "Mercado", "group": "desejos"},
    ])
    monkeypatch.setattr(budgets, "today_iso", lambda: "2026-10-26")
    result = asyncio.run(budgets.budget_suggestion(user={"id": "owner"}))
    assert result["expected_income"] == 1000
    assert result["categories"][0]["average"] == Decimal("166.67")
    assert result["categories"][0]["suggested"] == Decimal("166.67")
    assert result["categories"][0]["months_observed"] == 3
    assert result["writes_data"] is False



def test_budget_v2_projects_upcoming_subscription_once_and_never_debits_cash(monkeypatch):
    from decimal import Decimal
    entries = [tx("salary", kind="receita", value=3000, when="2026-10-05")]
    subscription = {
        "id": "sub", "name": "Streaming", "value": 49.90,
        "active": True, "recurrence": "mensal",
        "next_charge": "2026-10-29", "account_id": "bank",
        "card_id": None, "category_id": "streaming",
    }
    fake_db(monkeypatch, transactions=entries, cards=[], categories=[
        {"id": "streaming", "name": "Assinaturas", "group": "desejos"},
    ], subscriptions=[subscription])
    monkeypatch.setattr(budgets, "today_iso", lambda: "2026-10-26")
    cycle = {
        "id": "cycle", "start_date": "2026-10-01",
        "end_date": "2026-10-31", "expected_income": 3000,
        "allocations": [{
            "category_id": "streaming", "planned": 100,
            "priority": "flexivel", "rollover": False,
        }],
    }
    result = asyncio.run(budgets._progress(cycle, "owner"))
    assert result.received_income == 3000
    assert result.allocations[0].spent == 0
    assert result.allocations[0].committed == Decimal("49.90")
    assert result.safe_to_spend == Decimal("2950.10")

    # A manually scheduled invoice is the source of truth; the subscription
    # must not add a second R$49.90 commitment.
    entries.append(tx("scheduled-sub", kind="despesa", value=49.90,
                      when="2026-10-29", category="streaming"))
    entries[-1]["name"] = "Streaming"
    entries[-1]["status"] = "agendado"
    result = asyncio.run(budgets._progress(cycle, "owner"))
    assert result.allocations[0].committed == Decimal("49.90")
