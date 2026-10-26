"""FIN-08: archived cards' compensation events must remain in Radar history.

Account/card/category data is synthetic. The test makes no Firestore writes.
"""
import asyncio
from types import SimpleNamespace

from finnos.routers import radar


class Results:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, maximum):
        assert maximum >= len(self.rows)
        return self.rows


class Collection:
    def __init__(self, name, rows):
        self.name, self.rows = name, rows

    def find(self, query):
        assert query["user_id"] == "owner"
        # The radar must load *all* historical card documents, not just active.
        if self.name == "cards":
            assert "active" not in query
        return Results(self.rows)


def test_radar_deducts_merchant_credit_on_inactive_card(monkeypatch):
    purchase = {
        "id": "purchase", "name": "Notebook", "type": "despesa",
        "status": "pago", "date": "2026-10-03", "value": 400,
        "card_id": "archived", "account_id": "bank",
        "category_id": "shopping", "installment": False,
    }
    archived = {
        "id": "archived", "name": "Cartão antigo", "active": False,
        "invoice_adjustments": {
            "2026-10-29": [{
                "id": "credit", "purchase_id": "purchase",
                "date": "2026-10-20", "credit_cents": 10000,
            }],
        },
    }
    documents = {
        "transactions": [purchase],
        "categories": [{
            "id": "shopping", "name": "Compras",
            "monthly_budget": 400, "group": "desejos",
        }],
        "cards": [archived],
        "accounts": [{"id": "bank", "initial_balance": 1000}],
    }
    monkeypatch.setattr(radar, "today_iso", lambda: "2026-10-26")
    monkeypatch.setattr(radar, "db", SimpleNamespace(**{
        name: Collection(name, value)
        for name, value in documents.items()
    }))
    async def empty_states(uid):
        assert uid == "owner"
        return {}
    async def fake_context(uid):
        return documents["transactions"], {"bank": documents["accounts"][0]}
    async def no_patterns(uid, end):
        return []
    monkeypatch.setattr(radar, "_state_map", empty_states)
    monkeypatch.setattr(radar, "card_context", fake_context)
    monkeypatch.setattr(radar, "recurring_signals", no_patterns)

    result = asyncio.run(radar._signals("owner"))
    # With R$100 refunded, spending is R$300; this is only 75% of the
    # R$400 limit, below the budget-alert threshold of 85%.
    assert not any(item["id"].startswith("budget-shopping-") for item in result)
    # An archived card must not emit closing / future-installment warnings.
    assert not any(item.get("related_entity_id") == "archived" and
                   item.get("related_entity_type") == "card" for item in result)
