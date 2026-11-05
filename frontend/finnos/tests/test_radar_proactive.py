"""Proactive Radar alerts: an invoice due soon and a month running hotter than the last. Synthetic data."""
import asyncio
from types import SimpleNamespace

from finnos.routers import radar


class Results:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, maximum):
        return self.rows


class Collection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query):
        return Results(self.rows)


def run(monkeypatch, transactions, today, card=None):
    documents = {"transactions": transactions, "categories": [], "cards": [], "accounts": [{"id": "bank", "initial_balance": 5000}], "subscriptions": []}
    monkeypatch.setattr(radar, "today_iso", lambda: today)
    monkeypatch.setattr(radar, "db", SimpleNamespace(**{k: Collection(v) for k, v in documents.items()}))

    async def nothing(*args):
        return {} if len(args) == 1 else []

    async def context(uid):
        return transactions, {"bank": documents["accounts"][0]}

    monkeypatch.setattr(radar, "_state_map", nothing)
    monkeypatch.setattr(radar, "recurring_signals", nothing)
    monkeypatch.setattr(radar, "card_context", context)
    if card:
        documents["cards"].append({"id": card.id, "name": card.name, "active": True})

        async def build(doc, txs, accounts):
            return card

        monkeypatch.setattr(radar, "build_card", build)
    return asyncio.run(radar._signals("owner"))


def expense(day, value, month="2026-11"):
    return {"id": f"t{month}{day}", "name": "Compra", "type": "despesa", "status": "pago", "date": f"{month}-{day:02d}", "value": value, "account_id": "bank", "card_id": None, "installment": False}


def test_month_running_hotter_than_last_month(monkeypatch):
    txs = [expense(5, 1000, "2026-10"), expense(2, 600), expense(8, 300)]
    out = run(monkeypatch, txs, "2026-11-10")
    pace = next(s for s in out if s["id"] == "month-pace-2026-11")
    # R$ 900 in 10 days → R$ 2.700 in 30 days, +170% over October's R$ 1.000.
    # The amount above last month leads; the percentage stays in the description.
    assert pace["metric"] == "+R$ 1.700,00" and pace["severity"] == "high"
    assert "+170%" in pace["description"] and pace["impact"] == 1700


def test_no_pace_alert_early_in_the_month_or_when_cheaper(monkeypatch):
    assert not any(s["id"].startswith("month-pace") for s in run(monkeypatch, [expense(5, 1000, "2026-10"), expense(2, 600)], "2026-11-05"))
    assert not any(s["id"].startswith("month-pace") for s in run(monkeypatch, [expense(5, 9000, "2026-10"), expense(2, 600)], "2026-11-20"))


def test_invoice_due_soon(monkeypatch):
    card = SimpleNamespace(id="c1", name="Roxinho", payable_due="2026-11-12", payable_invoice=350, payable_cycle="2026-11", next_closing="2026-12-05", current_invoice=0, future_installments=0)
    out = run(monkeypatch, [], "2026-11-10", card)
    due = next(s for s in out if s["id"] == "card-due-c1-2026-11")
    assert due["title"] == "Fatura Roxinho vence em 2 dias" and due["severity"] == "high"
