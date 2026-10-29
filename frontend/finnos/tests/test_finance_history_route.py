"""Read-only finance history route uses UID scope and keyset pagination.

Synthetic Firestore data only; tests do not authenticate a real user or
mutate any Firebase collection.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from finnos.lib import db as store
from finnos.routers import finance_validation
from finnos.routers.auth import require_user


DATA = {
    "A": [
        {"id": "a3", "entity": "categories", "entity_id": "cat",
         "action": "updated", "created_at": "2026-10-26T12:03:00+00:00"},
        {"id": "a2", "entity": "transactions", "entity_id": "tx",
         "action": "created", "created_at": "2026-10-26T12:02:00+00:00"},
        {"id": "a1", "entity": "cards", "entity_id": "card",
         "action": "updated", "created_at": "2026-10-26T12:01:00+00:00"},
    ],
    "B": [
        {"id": "secret", "entity": "transactions", "entity_id": "private",
         "action": "created", "created_at": "2026-10-26T13:00:00+00:00"},
    ],
}


class Snapshot:
    def __init__(self, row):
        self.id, self.row = row["id"], row

    def to_dict(self):
        return dict(self.row)


class Query:
    def __init__(self, uid):
        self.uid, self.before, self.count = uid, None, None

    def order_by(self, field, direction=None):
        assert field == "created_at"
        return self

    def where(self, field, op, value):
        assert (field, op) == ("created_at", "<")
        self.before = value
        return self

    def limit(self, count):
        self.count = count
        return self

    def stream(self, timeout=None):
        assert timeout == 15
        rows = DATA[self.uid]
        if self.before:
            rows = [row for row in rows if row["created_at"] < self.before]
        return [Snapshot(row) for row in rows[:self.count]]


class Owner:
    def __init__(self, uid):
        self.uid = uid

    def collection(self, name):
        assert name == "finance_history"
        return Query(self.uid)


def client_for(uid, monkeypatch):
    monkeypatch.setattr(store, "scoped", lambda q: q["user_id"])
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, owner: Owner(owner))
    app = FastAPI()
    app.include_router(finance_validation.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": uid}
    return TestClient(app)


def test_financial_history_is_read_only_paginated_and_scoped(monkeypatch):
    with client_for("A", monkeypatch) as client:
        first = client.get("/api/finance/history", params={"limit": 2})
        assert first.status_code == 200, first.text
        payload = first.json()
        assert [item["id"] for item in payload["items"]] == ["a3", "a2"]
        assert payload["next_cursor"] == "2026-10-26T12:02:00+00:00"
        second = client.get("/api/finance/history", params={
            "limit": 2, "before": payload["next_cursor"],
        })
        assert second.status_code == 200
        assert [item["id"] for item in second.json()["items"]] == ["a1"]
        assert second.json()["next_cursor"] is None
        bad = client.get("/api/finance/history", params={"before": "invalid"})
        assert bad.status_code == 422


def test_other_uid_cannot_receive_first_users_history(monkeypatch):
    with client_for("B", monkeypatch) as client:
        response = client.get("/api/finance/history")
        assert response.status_code == 200, response.text
        assert [item["id"] for item in response.json()["items"]] == ["secret"]
