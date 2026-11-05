"""Investment positions: UID-scoped CRUD with validation. Synthetic data, in-memory store."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from finnos.routers import investments


class Store:
    def __init__(self):
        self.rows = []

    def find(self, query):
        rows = [r for r in self.rows if r["user_id"] == query["user_id"]]
        return SimpleNamespace(to_list=lambda maximum: asyncio.sleep(0, result=rows))

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    async def update_one(self, query, update):
        matched = [r for r in self.rows if r["id"] == query["id"] and r["user_id"] == query["user_id"]]
        for r in matched:
            r.update(update["$set"])
        return SimpleNamespace(matched_count=len(matched))

    async def find_one(self, query):
        return next((r for r in self.rows if r["id"] == query["id"] and r["user_id"] == query["user_id"]), None)

    async def delete_one(self, query):
        before = len(self.rows)
        self.rows = [r for r in self.rows if not (r["id"] == query["id"] and r["user_id"] == query["user_id"])]
        return SimpleNamespace(deleted_count=before - len(self.rows))


def payload(**over):
    return investments.InvestmentIn(**{"name": "Tesouro Selic", "kind": "tesouro", "invested": 1000, "current": 1042.5, "updated_on": "2026-11-04", **over})


def test_crud_is_scoped_to_the_owner(monkeypatch):
    store = Store()
    monkeypatch.setattr(investments, "db", SimpleNamespace(investments=store))
    me, other = {"id": "u1"}, {"id": "u2"}
    created = asyncio.run(investments.create_investment(payload(), user=me))
    assert [i.name for i in asyncio.run(investments.list_investments(user=me))] == ["Tesouro Selic"]
    assert asyncio.run(investments.list_investments(user=other)) == []
    updated = asyncio.run(investments.update_investment(created.id, payload(current=1100), user=me))
    assert float(updated.current) == 1100
    with pytest.raises(HTTPException) as error:
        asyncio.run(investments.update_investment(created.id, payload(), user=other))
    assert error.value.status_code == 404
    asyncio.run(investments.delete_investment(created.id, user=me))
    assert asyncio.run(investments.list_investments(user=me)) == []


def test_rejects_negative_values_and_unknown_kinds():
    with pytest.raises(ValidationError):
        payload(invested=-1)
    with pytest.raises(ValidationError):
        payload(kind="bolsa")
