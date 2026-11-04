"""ARQ-02: direct UID-scoped ID reads never scan 20,000 Firestore documents.

Tests exercise actual db.Collection with a fake Firestore document interface.
"""
import asyncio
from copy import deepcopy
from types import SimpleNamespace

from finnos.lib import db as store


class Snapshot:
    def __init__(self, identifier, value):
        self.id = identifier
        self.value = deepcopy(value)
        self.exists = value is not None

    def to_dict(self):
        return deepcopy(self.value)


class Ref:
    def __init__(self, documents, uid, name, identifier, metrics):
        self.documents, self.uid, self.name = documents, uid, name
        self.identifier, self.metrics = identifier, metrics

    def get(self, transaction=None):
        self.metrics.append((self.uid, self.name, self.identifier))
        return Snapshot(self.identifier, self.documents.get((self.uid, self.name, self.identifier)))


class Root:
    def __init__(self, documents, uid, metrics):
        self.documents, self.uid, self.metrics = documents, uid, metrics

    def collection(self, name):
        root = self
        return SimpleNamespace(
            document=lambda identifier: Ref(
                root.documents, root.uid, name, identifier, root.metrics,
            )
        )


def test_exact_id_reads_respect_uid_and_other_predicates(monkeypatch):
    documents = {
        ("alice", "accounts", "a"): {"id": "a", "name": "Minha conta", "user_id": "alice"},
        ("bob", "accounts", "a"): {"id": "a", "name": "Conta secreta", "user_id": "bob"},
    }
    requests = []
    monkeypatch.setattr(store, "scoped", lambda query: query["user_id"])
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Root(documents, uid, requests))
    monkeypatch.setattr(store, "rows", lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("single-record query must never scan a whole collection")
    ))

    alice = asyncio.run(store.db.accounts.find_one({"id": "a", "user_id": "alice"}))
    bob = asyncio.run(store.db.accounts.find_one({"id": "a", "user_id": "bob"}))
    missing = asyncio.run(store.db.accounts.find_one({
        "id": "a", "user_id": "alice", "name": "Outros dados",
    }))
    assert alice["name"] == "Minha conta"
    assert bob["name"] == "Conta secreta"
    assert missing is None
    assert requests == [
        ("alice", "accounts", "a"), ("bob", "accounts", "a"),
        ("alice", "accounts", "a"),
    ]


def test_matching_rows_only_uses_direct_id_path_for_exact_ids(monkeypatch):
    docs = {("alice", "cards", "card"): {"id": "card", "active": True}}
    reqs = []
    monkeypatch.setattr(store, "root", lambda db, uid: Root(docs, uid, reqs))
    monkeypatch.setattr(store, "rows", lambda db, uid, name, tr=None: [
        {"id": "card", "active": True, "user_id": uid},
    ])
    assert store.matching_rows(None, "alice", "cards", {
        "id": "card", "user_id": "alice", "active": True,
    })[0]["id"] == "card"
    assert store.matching_rows(None, "alice", "cards", {
        "id": "card", "user_id": "alice", "active": False,
    }) == []
    assert store.matching_rows(None, "alice", "cards", {
        "user_id": "alice", "active": True,
    })[0]["id"] == "card"
    assert len(reqs) == 2
