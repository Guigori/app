"""The kept answer is the same model the route computed, and it is used only for the same revision and day."""
import asyncio
from decimal import Decimal

from pydantic import BaseModel

from finnos.lib import response_cache


class Out(BaseModel):
    total: Decimal
    names: list[str]


class Snap:
    def __init__(self, data): self.data = data
    @property
    def exists(self): return self.data is not None
    def to_dict(self): return self.data


class Ref:
    def __init__(self, store): self.store = store
    def get(self): return Snap(self.store.get("doc"))
    def set(self, data): self.store["doc"] = data


def setup(monkeypatch, revision, day, store):
    from finnos.lib import db, account_balances, dates

    async def rev(uid): return revision[0]
    monkeypatch.setattr(account_balances, "finance_revision", rev)
    monkeypatch.setattr(dates, "today_iso", lambda: day[0])
    monkeypatch.setattr(db, "client", lambda: object())

    class Root:
        def collection(self, name):
            class C:
                def document(self, key): return Ref(store)
            return C()
    monkeypatch.setattr(db, "root", lambda client, uid: Root())


def test_same_revision_and_day_reuses_the_answer(monkeypatch):
    revision, day, store, calls = [5], ["2026-11-15"], {}, []
    setup(monkeypatch, revision, day, store)

    @response_cache.revision_cached("t", Out)
    async def route(month=None, user=None):
        calls.append(month)
        return Out(total=Decimal("10.50"), names=["a"])

    first = asyncio.run(route(month="2026-11", user={"id": "u"}))
    second = asyncio.run(route(month="2026-11", user={"id": "u"}))
    assert first == second == Out(total=Decimal("10.50"), names=["a"])
    assert calls == ["2026-11"]
    revision[0] = 6
    asyncio.run(route(month="2026-11", user={"id": "u"}))
    assert calls == ["2026-11", "2026-11"]
    day[0] = "2026-11-16"
    asyncio.run(route(month="2026-11", user={"id": "u"}))
    assert len(calls) == 3


def test_internal_positional_calls_and_disabled_cache_compute(monkeypatch):
    monkeypatch.setenv("FINNOS_RESPONSE_CACHE", "0")
    calls = []

    @response_cache.revision_cached("t", Out)
    async def route(month=None, user=None):
        calls.append(1)
        return Out(total=Decimal("1"), names=[])

    asyncio.run(route(month="x", user={"id": "u"}))
    asyncio.run(route(month="x", user={"id": "u"}))
    assert len(calls) == 2
