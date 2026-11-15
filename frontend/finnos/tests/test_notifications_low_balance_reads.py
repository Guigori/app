"""Notifications only recalculate every balance (a scan of the whole history) when some account has an alert on."""
import asyncio
from datetime import date
from types import SimpleNamespace

from finnos.routers import accounts as accounts_router
from finnos.routers import notifications


class Results:
    def __init__(self, rows): self.rows = rows
    async def to_list(self, maximum): return self.rows


class Collection:
    def __init__(self, rows): self.rows = rows
    def find(self, query): return Results(self.rows)


def run(monkeypatch, account_docs):
    calls = []

    async def enriched(uid):
        calls.append(uid)
        return []
    monkeypatch.setattr(notifications, "db", SimpleNamespace(accounts=Collection(account_docs), transactions=Collection([])))
    monkeypatch.setattr(accounts_router, "_enriched_accounts", enriched)
    asyncio.run(notifications._low_balance_alerts("owner", date(2026, 11, 15), set()))
    return calls


def test_no_alert_means_no_balance_scan(monkeypatch):
    assert run(monkeypatch, [{"id": "a1", "active": True}, {"id": "a2", "active": True, "low_balance_alert": None}]) == []


def test_an_alert_on_keeps_the_check(monkeypatch):
    assert run(monkeypatch, [{"id": "a1", "active": True, "low_balance_alert": 100}]) == ["owner"]


def test_benefit_alerts_also_keep_it(monkeypatch):
    assert run(monkeypatch, [{"id": "b1", "active": True, "benefit_runout_alert": True}]) == ["owner"]
