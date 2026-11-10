"""One lançamento's history: only its own events, only the owner's, newest first."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from finnos.lib import db as store
from finnos.routers import transactions
from finnos.routers.auth import require_user

DATA = {
    "A": [
        {"id": "e1", "entity": "transactions", "entity_id": "tx", "action": "created", "created_at": "2026-11-10T10:00:00+00:00",
         "before": None, "after": {"name": "Uber", "value_cents": 4500}},
        {"id": "e2", "entity": "transactions", "entity_id": "tx", "action": "updated", "created_at": "2026-11-10T11:00:00+00:00",
         "before": {"name": "Uber", "value_cents": 4500}, "after": {"name": "Uber", "value_cents": 6000}},
        {"id": "e3", "entity": "categories", "entity_id": "tx", "action": "updated", "created_at": "2026-11-10T12:00:00+00:00"},
        {"id": "e4", "entity": "transactions", "entity_id": "other", "action": "created", "created_at": "2026-11-10T12:00:00+00:00"},
    ],
    "B": [{"id": "x", "entity": "transactions", "entity_id": "tx", "action": "created", "created_at": "2026-11-10T09:00:00+00:00"}],
}


class Snap:
    def __init__(self, row): self.id, self.row = row["id"], row
    def to_dict(self): return dict(self.row)


class Query:
    def __init__(self, uid): self.uid, self.value = uid, None
    def where(self, field, op, value):
        assert (field, op) == ("entity_id", "==")
        self.value = value
        return self
    def limit(self, n): return self
    def stream(self, timeout=None):
        return [Snap(r) for r in DATA[self.uid] if r["entity_id"] == self.value]


class Owner:
    def __init__(self, uid): self.uid = uid
    def collection(self, name):
        assert name == "finance_history"
        return Query(self.uid)


def client_for(uid, monkeypatch):
    monkeypatch.setattr(store, "scoped", lambda q: q["user_id"])
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, owner: Owner(owner))
    app = FastAPI()
    app.include_router(transactions.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": uid}
    return TestClient(app)


def test_history_lists_only_this_transaction_newest_first(monkeypatch):
    items = client_for("A", monkeypatch).get("/api/transactions/tx/history").json()["items"]
    assert [i["id"] for i in items] == ["e2", "e1"]
    assert items[0]["after"]["value_cents"] == 6000


def test_history_is_scoped_to_the_owner(monkeypatch):
    items = client_for("B", monkeypatch).get("/api/transactions/tx/history").json()["items"]
    assert [i["id"] for i in items] == ["x"]
