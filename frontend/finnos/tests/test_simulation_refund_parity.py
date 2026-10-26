"""FIN-08: purchase simulation uses same bank ledger and settled invoice logic.

Exercise the actual FastAPI business function with an isolated read-only fake
database; no Vercel deploy, Firebase credentials, or production writes.
"""
import asyncio
from types import SimpleNamespace

from finnos.lib.competency import monthly_competency
from finnos.routers import simulation


class Results:
    def __init__(self, items):
        self.items = items

    async def to_list(self, maximum):
        return self.items[:maximum]


class Collection:
    def __init__(self, items):
        self.items = items

    def find(self, query):
        assert query["user_id"] == "owner"
        return Results(self.items)

    async def find_one(self, query):
        assert query["user_id"] == "owner"
        return None


def test_simulation_reconciles_real_bank_refund_without_recharging_paid_invoice(monkeypatch):
    card = {
        "id": "card", "name": "Cartão", "limit": 2000,
        "closing_day": 29, "due_day": 7, "active": False,
        "invoice_cycles": {"2026-09-29": {
            "items": [{
                "id": "purchase", "name": "Notebook",
                "date": "2026-09-20", "purchase_cents": 30000,
                "category_name": "Compras", "category_color": None,
                "installment_label": None,
            }],
            "paid_cents": 30000, "paid_at": "2026-10-07",
        }},
        "invoice_refunds": {"2026-09-29": [{
            "id": "refund", "purchase_id": "purchase",
            "account_id": "bank", "date": "2026-10-26",
            "refund_cents": 10000, "reason": "Devolução",
        }]},
    }
    txs = [
        {
            "id": "purchase", "name": "Notebook", "type": "despesa",
            "status": "pago", "date": "2026-09-20",
            "value": 300, "card_id": "card", "account_id": "bank",
            "category_id": "shopping",
        },
        {
            "id": "salary", "type": "receita", "status": "pago",
            "date": "2026-10-05", "value": 500, "account_id": "bank",
        },
        {
            "id": "payment", "type": "despesa", "status": "pago",
            "date": "2026-10-07", "value": 300, "account_id": "bank",
            "invoice_payment": True,
        },
        {
            "id": "refund", "type": "receita", "status": "pago",
            "date": "2026-10-26", "value": 100, "account_id": "bank",
            "invoice_refund": True, "invoice_card_id": "card",
            "original_purchase_id": "purchase",
        },
        {
            "id": "upcoming", "type": "despesa", "status": "agendado",
            "date": "2026-11-01", "value": 200, "account_id": "bank",
        },
    ]
    collections = {
        "accounts": [{"id": "bank", "initial_balance": 1000}],
        "transactions": txs, "cards": [card], "budget_cycles": [],
    }
    monkeypatch.setattr(simulation, "db", SimpleNamespace(**{
        name: Collection(items) for name, items in collections.items()
    }))
    monkeypatch.setattr(simulation, "today_iso", lambda: "2026-10-26")
    result = asyncio.run(simulation.purchase(
        simulation.PurchaseSimulationIn(
            amount=100, installments=1, compare_installments=False,
        ),
        user={"id": "owner"},
    ))
    assert result["balance_now"] == 1300  # initial + salary - invoice + bank refund
    assert result["projected_30d_before"] == 1100  # pending payment only
    assert result["projected_30d_after"] == 1000  # simulated purchase
    assert result["cash_impact_30d"] == 100
    assert result["card"] is None and result["budget"] is None
    assert result["writes_data"] is False

    monthly = monthly_competency(txs, [card], "2026-10")
    assert monthly["income"] == 500
    assert monthly["expense"] == -100
    assert monthly["net"] == 600
