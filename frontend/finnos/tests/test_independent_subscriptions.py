"""Subscription CRUD must never transform or delete fixed transactions."""
import re
from copy import deepcopy
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from finnos.routers import subscriptions
from finnos.routers.auth import require_user


class Cursor:
    def __init__(self, records, query):
        self.records, self.query = records, query

    async def to_list(self, maximum):
        matched = []
        for doc in self.records:
            ok = True
            for key, value in self.query.items():
                actual = doc.get(key)
                if isinstance(value, dict) and "$regex" in value:
                    if not re.search(value["$regex"], actual or ""):
                        ok = False
                elif actual != value:
                    ok = False
            if ok:
                matched.append(deepcopy(doc))
        assert len(matched) <= maximum
        return matched


class Collection:
    def __init__(self, initial=None):
        self.records = list(initial or [])

    def find(self, query):
        return Cursor(self.records, query)

    async def find_one(self, query):
        found = await self.find(query).to_list(500)
        return found[0] if found else None

    async def insert_one(self, doc):
        self.records.append(deepcopy(doc))

    async def update_one(self, query, update):
        for doc in self.records:
            if all(doc.get(key) == value for key, value in query.items()):
                doc.update(update["$set"])
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def delete_one(self, query):
        for index, doc in enumerate(self.records):
            if all(doc.get(key) == value for key, value in query.items()):
                del self.records[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


def payload(name="Spotify", value=20, recurrence="mensal"):
    return {
        "name": name, "value": value, "recurrence": recurrence,
        "next_charge": "2026-10-15", "account_id": "alice-account",
        "category_id": None, "card_id": None, "active": True, "notes": "Individual",
    }


def test_subscriptions_are_independent_from_fixed_transactions(monkeypatch):
    fake = SimpleNamespace(
        accounts=Collection([{"id": "alice-account", "name": "Nubank", "user_id": "alice"},
                             {"id": "bob-account", "name": "Inter", "user_id": "bob"}]),
        categories=Collection([]),
        cards=Collection([]),
        subscriptions=Collection([]),
        transactions=Collection([
            {"id": "legacy-fixed", "user_id": "alice", "type": "despesa",
             "fixed": True, "status": "pago", "date": "2026-10-01", "value": 999},
            {"id": "salary", "user_id": "alice", "type": "receita",
             "status": "pago", "date": "2026-10-01", "value": 1000},
        ]),
    )
    monkeypatch.setattr(subscriptions, "db", fake)
    monkeypatch.setattr(subscriptions, "today_iso", lambda: "2026-10-14")
    user = {"id": "alice"}
    app = FastAPI()
    app.include_router(subscriptions.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: user

    with TestClient(app) as client:
        initial = client.get("/api/subscriptions")
        assert initial.status_code == 200, initial.text
        assert initial.json()["items"] == []
        assert initial.json()["monthly_total"] == 0

        created = client.post("/api/subscriptions", json=payload())
        assert created.status_code == 201, created.text
        identifier = created.json()["id"]
        assert created.json()["account_name"] == "Nubank"
        assert created.json()["notes"] == "Individual"

        yearly = client.post("/api/subscriptions", json=payload("iCloud", 120, "anual"))
        assert yearly.status_code == 201, yearly.text

        result = client.get("/api/subscriptions").json()
        assert len(result["items"]) == 2
        assert result["monthly_total"] == 30
        assert result["yearly_total"] == 360
        assert result["income_percent"] == 3

        assert client.put("/api/subscriptions/" + identifier, json={**payload(), "name": "Spotify Family", "active": False}).status_code == 200
        assert client.get("/api/subscriptions").json()["monthly_total"] == 10
        assert client.get("/api/subscriptions/" + identifier).json()["name"] == "Spotify Family"

        user["id"] = "bob"
        assert client.get("/api/subscriptions").json()["items"] == []
        assert client.get("/api/subscriptions/" + identifier).status_code == 404
        assert client.put("/api/subscriptions/" + identifier, json=payload()).status_code == 400
        assert client.delete("/api/subscriptions/" + identifier).status_code == 404

        user["id"] = "alice"
        invalid = client.post("/api/subscriptions", json={**payload(), "category_id": "another-user"})
        assert invalid.status_code == 400
        invalid_date = client.post("/api/subscriptions", json={**payload(), "next_charge": "2026-02-30"})
        assert invalid_date.status_code == 422

        assert client.delete("/api/subscriptions/" + identifier).status_code == 204
        assert fake.transactions.records[0]["id"] == "legacy-fixed"
        assert len(fake.transactions.records) == 2


def test_next_annual_charge_handles_leap_day():
    from datetime import date
    assert subscriptions._charge_day(date(2024, 2, 29), "anual", date(2025, 2, 27)) == "2025-02-28"
    assert subscriptions._charge_day(date(2024, 2, 29), "anual", date(2025, 3, 1)) == "2026-02-28"
