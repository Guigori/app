"""The cash flow lists what is still expected item by item, and can follow one account."""
import asyncio
from decimal import Decimal
from types import SimpleNamespace

from finnos.routers import analytics


def run(monkeypatch, docs, **params):
    class Cursor:
        def __init__(self, rows): self.rows = rows
        async def to_list(self, limit): return self.rows

    class Coll:
        def __init__(self, kind): self.kind = kind
        def find(self, query): return Cursor(docs[self.kind])

    monkeypatch.setattr(analytics, "db", SimpleNamespace(**{name: Coll(name) for name in docs}))
    monkeypatch.setattr(analytics, "today_iso", lambda: "2026-11-05")
    async def revision(uid): return 1
    async def history(uid, months, cards, expected): return docs["transactions"]
    monkeypatch.setattr(analytics, "finance_revision", revision)
    monkeypatch.setattr(analytics, "read_projection_history", history)
    base = dict(month="2026-11", months=2, from_month=None, to_month=None, category_id=None, user={"id": "owner"})
    return asyncio.run(analytics.flow(**{**base, **params}))


def tx(**extra):
    return {"id": extra.get("id", extra["name"]), "type": "despesa", "status": "pago", "date": "2026-11-02",
            "value": 100, "account_id": "bank", "category_id": "home", **extra}


DOCS = {
    "transactions": [
        tx(name="Mercado", value=300),
        tx(name="Aluguel", value=1400, fixed=True, recurrence="mensal", date="2026-10-10"),
        tx(name="Luz", value=180, status="agendado", date="2026-11-20"),
        tx(name="TV", value=1000, installment=True, total_installments=10, current_installment=1,
           installment_value=100, status="agendado", date="2026-10-15"),
        tx(name="Salário", type="receita", value=5000, status="agendado", date="2026-11-05", account_id="other"),
    ],
    "cards": [],
    "categories": [{"id": "home", "name": "Moradia", "color": "#000", "icon": "home"}],
    "subscriptions": [{"id": "sub", "name": "Spotify", "active": True, "value": Decimal("21.90"),
                       "next_charge": "2026-11-28", "recurrence": "mensal", "account_id": "bank",
                       "card_id": None, "category_id": "home"}],
}


def test_upcoming_items_add_up_to_the_month_projection(monkeypatch):
    out = run(monkeypatch, DOCS)
    kinds = {(item.name, item.kind) for item in out.upcoming}
    assert {("Aluguel", "fixa"), ("Luz", "agendado"), ("TV", "parcela"), ("Spotify", "assinatura"), ("Salário", "agendado")} <= kinds
    spend = sum(item.value for item in out.upcoming if item.type == "despesa")
    gain = sum(item.value for item in out.upcoming if item.type == "receita")
    assert spend == out.projected_expense
    assert gain == out.projected_income
    luz = next(item for item in out.upcoming if item.name == "Luz")
    assert (luz.date, luz.transaction_id, luz.category_name) == ("2026-11-20", "Luz", "Moradia")


def test_account_filter_keeps_only_that_account(monkeypatch):
    out = run(monkeypatch, DOCS, account_id="other")
    assert [item.name for item in out.upcoming] == ["Salário"]
    assert out.projected_expense == 0
    assert out.expense == 0
