"""HTTP contract tests for Firestore CRUD and cross-user isolation.

Uses an in-memory Firestore double; does not require Firebase credentials or
touch MongoDB/production. Identity is injected through the FastAPI dependency.
"""
from copy import deepcopy
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from lib.firebase_auth import require_verified_firebase_user
from routers import firebase_transactions as module

class Snapshot:
    def __init__(self, value):
        self.exists = value is not None
        self.value = deepcopy(value)
    def to_dict(self):
        return deepcopy(self.value)

class Document:
    def __init__(self, store, key):
        self.store, self.key = store, key
    def collection(self, name):
        return Collection(self.store, self.key + (name,))
    def get(self):
        return Snapshot(self.store.get(self.key))
    def create(self, value):
        if self.key in self.store:
            raise ValueError("already exists")
        self.store[self.key] = deepcopy(value)
    def set(self, value):
        self.store[self.key] = deepcopy(value)
    def delete(self):
        self.store.pop(self.key, None)

class Collection:
    def __init__(self, store, prefix):
        self.store, self.prefix = store, prefix
        self.maximum = 100
    def document(self, name):
        return Document(self.store, self.prefix + (name,))
    def limit(self, number):
        self.maximum = number
        return self
    def stream(self):
        return [Snapshot(v) for k, v in self.store.items()
                if k[:-1] == self.prefix][:self.maximum]

class Firestore:
    def __init__(self):
        self.store = {}
    def collection(self, name):
        return Collection(self.store, (name,))

@pytest.fixture
def api(monkeypatch):
    db = Firestore()
    monkeypatch.setattr(module, "get_firestore", lambda: db)
    app = FastAPI()
    app.include_router(module.router, prefix="/api")
    active = {"uid": "user-a", "email_verified": True}
    app.dependency_overrides[require_verified_firebase_user] = lambda: active
    with TestClient(app) as client:
        yield client, active, db
    app.dependency_overrides.clear()

def payload():
    return {"name": "Mercado", "value": 12.35, "type": "despesa",
            "date": "2026-10-12", "account_id": "account-1"}

def test_create_list_get_update_delete(api):
    client, identity, db = api
    response = client.post("/api/firebase/transactions", json=payload())
    assert response.status_code == 201, response.text
    tx = response.json()
    assert tx["value"] == 12.35
    tx_id = tx["id"]
    assert db.store[("users", "user-a", "transactions", tx_id)]["value_cents"] == 1235
    assert len(client.get("/api/firebase/transactions").json()) == 1
    assert client.get(f"/api/firebase/transactions/{tx_id}").json()["name"] == "Mercado"
    updated = dict(payload(), name="Aluguel", value=850.10)
    result = client.put(f"/api/firebase/transactions/{tx_id}", json=updated)
    assert result.status_code == 200
    assert result.json()["value"] == 850.1
    assert result.json()["name"] == "Aluguel"
    assert client.delete(f"/api/firebase/transactions/{tx_id}").status_code == 204
    assert client.get(f"/api/firebase/transactions/{tx_id}").status_code == 404

def test_three_users_cannot_read_edit_or_delete_each_others_records(api):
    client, identity, db = api
    ids = {}
    for uid in ("user-a", "user-b", "user-c"):
        identity["uid"] = uid
        response = client.post("/api/firebase/transactions", json=payload())
        assert response.status_code == 201
        ids[uid] = response.json()["id"]
    for uid in ids:
        identity["uid"] = uid
        listing = client.get("/api/firebase/transactions")
        assert listing.status_code == 200
        assert [item["id"] for item in listing.json()] == [ids[uid]]
        for other_uid in ids:
            if other_uid == uid:
                continue
            target = ids[other_uid]
            assert client.get(f"/api/firebase/transactions/{target}").status_code == 404
            assert client.put(f"/api/firebase/transactions/{target}", json=payload()).status_code == 404
            assert client.delete(f"/api/firebase/transactions/{target}").status_code == 404
    assert len(db.store) == 3

def test_bad_uuid_rejected(api):
    client, _, _ = api
    assert client.get("/api/firebase/transactions/not-a-uuid").status_code == 422
