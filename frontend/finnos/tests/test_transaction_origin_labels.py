"""Origin label: stored trimmed on the lançamento and suggested again from history."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from finnos.models.finnos import TransactionIn
from finnos.routers import transactions


def payload(**extra):
    return TransactionIn(name="Uber", value=10, type="despesa", date="2026-10-20", account_id="a", **extra)


def test_origin_is_trimmed_and_blank_becomes_none():
    assert transactions._document("u", payload(origin="  Mercado Pago ")) ["origin"] == "Mercado Pago"
    assert transactions._document("u", payload(origin="   "))["origin"] is None
    assert transactions._document("u", payload())["origin"] is None


class FakeFind:
    def __init__(self, rows): self.rows = rows
    def sort(self, *_): return self
    async def to_list(self, _): return self.rows


def test_origin_history_counts_labels_case_insensitively(monkeypatch):
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    rows = [{"origin": "iFood", "created_at": now}, {"origin": None}, {"origin": "ifood"}, {"origin": "Nubank"}]
    fake = SimpleNamespace(transactions=SimpleNamespace(find=lambda _q: FakeFind(rows)))
    monkeypatch.setattr(transactions, "db", fake)
    result = asyncio.run(transactions.list_origins(user={"id": "u"}))
    assert result["items"] == [{"label": "iFood", "count": 2}, {"label": "Nubank", "count": 1}]
