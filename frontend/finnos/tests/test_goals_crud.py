"""Regression tests for Firestore-backed goal detail, editing, and deletion."""
from copy import deepcopy
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from finnos.routers import goals
from finnos.routers.auth import require_user


def sample(name="Viagem", saved=20):
    return {
        "name": name, "category": "Viagem", "mode": "tradicional",
        "target": 500, "saved": saved, "months": 12,
        "contribution": 40, "frequency": "Mensal",
        "account": "bank-a", "strategy": None,
        "remind": True, "radar": True,
    }


class GoalsStore:
    def __init__(self):
        self.items = {
            ("alice", "g-a"): {**sample(), "id": "g-a", "user_id": "alice",
                               "createdAt": "2026-10-01T12:00:00+00:00"},
            ("bob", "g-b"): {**sample("Privada"), "id": "g-b", "user_id": "bob",
                             "createdAt": "2026-10-01T12:00:00+00:00"},
        }

    async def find_one(self, query):
        doc = self.items.get((query["user_id"], query["id"]))
        return deepcopy(doc) if doc else None

    async def update_one(self, query, update):
        key = (query["user_id"], query["id"])
        if key not in self.items:
            return SimpleNamespace(matched_count=0)
        # Only mutable fields get updated, not id, UID or createdAt.
        self.items[key].update(update["$set"])
        return SimpleNamespace(matched_count=1)

    async def delete_one(self, query):
        return SimpleNamespace(deleted_count=int(
            self.items.pop((query["user_id"], query["id"]), None) is not None
        ))


def test_goals_crud_scoped_by_firebase_uid(monkeypatch):
    store = GoalsStore()
    monkeypatch.setattr(goals, "db", SimpleNamespace(goals=store))
    app = FastAPI()
    app.include_router(goals.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": "alice"}
    with TestClient(app) as client:
        existing = client.get("/api/goals/g-a")
        assert existing.status_code == 200, existing.text
        assert existing.json()["createdAt"] == "2026-10-01T12:00:00+00:00"
        assert "user_id" not in existing.json()

        assert client.get("/api/goals/g-b").status_code == 404
        assert client.put("/api/goals/g-b", json=sample("Tentativa")).status_code == 404
        assert client.delete("/api/goals/g-b").status_code == 404

        edited = client.put("/api/goals/g-a", json=sample("Intercâmbio", 40))
        assert edited.status_code == 200, edited.text
        assert edited.json()["name"] == "Intercâmbio"
        assert edited.json()["saved"] == 40
        assert edited.json()["id"] == "g-a"
        assert edited.json()["createdAt"] == existing.json()["createdAt"]
        assert "user_id" not in edited.json()

        invalid = client.put("/api/goals/g-a", json=sample(saved=501))
        assert invalid.status_code == 422
        assert store.items[("alice", "g-a")]["saved"] == 40

        assert client.delete("/api/goals/g-a").status_code == 204
        assert client.get("/api/goals/g-a").status_code == 404
        assert store.items[("bob", "g-b")]["name"] == "Privada"


def test_goals_suggestion_route_not_shadowed_by_detail():
    routes = [(route.path, frozenset(route.methods or [])) for route in goals.router.routes]
    index = next(i for i, (path, methods) in enumerate(routes)
                 if path.endswith("/suggestion") and "GET" in methods)
    detail_index = next(i for i, (path, methods) in enumerate(routes)
                        if path.endswith("/{goal_id}") and "GET" in methods)
    assert index < detail_index


def test_goal_movements_keep_source_kind_and_old_records(monkeypatch):
    store = GoalsStore()
    monkeypatch.setattr(goals, "db", SimpleNamespace(goals=store))
    app = FastAPI()
    app.include_router(goals.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": "alice"}
    body = {**sample(saved=70), "deposits": [
        {"date": "2026-10-05", "value": 30},
        {"date": "2026-10-20", "value": 50, "kind": "aporte", "account_id": "bank-a", "note": "13º"},
        {"date": "2026-11-02", "value": 30, "kind": "retirada", "goal_id": "g-other"},
    ]}
    with TestClient(app) as client:
        saved = client.put("/api/goals/g-a", json=body)
        assert saved.status_code == 200, saved.text
        moves = saved.json()["deposits"]
        assert moves[0]["kind"] == "aporte" and moves[0]["account_id"] is None
        assert moves[1]["account_id"] == "bank-a" and moves[1]["note"] == "13º"
        assert moves[2]["kind"] == "retirada" and moves[2]["goal_id"] == "g-other"
        bad = client.put("/api/goals/g-a", json={**body, "deposits": [{"date": "2026-11-02", "value": 1, "kind": "saque"}]})
        assert bad.status_code == 422
