"""The Radar budget alert follows the active budget cycle and speaks in reais. Synthetic data."""
import asyncio
from decimal import Decimal
from types import SimpleNamespace

from finnos.routers import budgets, radar


class Results:
    def __init__(self, rows): self.rows = rows
    async def to_list(self, maximum): return self.rows


class Collection:
    def __init__(self, rows): self.rows = rows
    def find(self, query): return Results(self.rows)
    async def find_one(self, query, sort=None): return self.rows[0] if self.rows else None


def run(monkeypatch, categories, cycles, allocations):
    tx = {"id": "t1", "name": "Loja", "type": "despesa", "status": "pago", "date": "2026-11-03",
          "value": 800, "account_id": "bank", "category_id": "shop"}
    docs = {"transactions": [tx], "categories": categories, "cards": [], "subscriptions": [],
            "accounts": [{"id": "bank", "initial_balance": 5000}], "budget_cycles": cycles}
    monkeypatch.setattr(radar, "today_iso", lambda: "2026-11-05")
    monkeypatch.setattr(radar, "db", SimpleNamespace(**{k: Collection(v) for k, v in docs.items()}))

    async def nothing(*args): return {} if len(args) == 1 else []
    async def context(uid): return [tx], {"bank": docs["accounts"][0]}
    async def progress(cycle, uid): return SimpleNamespace(allocations=allocations)
    monkeypatch.setattr(radar, "_state_map", nothing)
    monkeypatch.setattr(radar, "recurring_signals", nothing)
    monkeypatch.setattr(radar, "card_context", context)
    monkeypatch.setattr(budgets, "_progress", progress)
    return [s for s in asyncio.run(radar._signals("owner")) if s["id"].startswith("budget-")]


CATEGORY = [{"id": "shop", "name": "Compras", "monthly_budget": 300}]


def test_monthly_limit_alert_is_in_reais(monkeypatch):
    [alert] = run(monkeypatch, CATEGORY, [], [])
    assert alert["metric"] == "R$ 500,00 acima"
    assert alert["impact"] == Decimal("500.00")
    assert alert["description"] == "R$ 800,00 gastos de R$ 300,00 planejados"


def test_cycle_limit_replaces_the_monthly_one(monkeypatch):
    cycle = {"id": "c1", "end_date": "2026-11-30"}
    allocation = SimpleNamespace(category_id="shop", spent=Decimal("800"), planned=Decimal("900"))
    [alert] = run(monkeypatch, CATEGORY, [cycle], [allocation])
    assert alert["title"] == "Compras está perto do limite"
    assert alert["metric"] == "Restam R$ 100,00"
    assert alert["impact"] is None
    assert alert["expires_at"] == "2026-11-30"
    assert "no ciclo do orçamento" in alert["description"]
