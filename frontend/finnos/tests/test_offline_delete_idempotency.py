"""SYNC-02: Firestore transaction deletion is UID-isolated, versioned and replay safe.

The collection and transaction APIs below are synthetic, with no credentials,
production records or real database writes.
"""
import asyncio
from copy import deepcopy

import pytest
from fastapi import HTTPException

from finnos.lib import db as store


class Snap:
    def __init__(self, value, identifier=None):
        self.id = identifier
        self.exists = value is not None
        self.value = deepcopy(value)
    def to_dict(self):
        return deepcopy(self.value) if self.value is not None else None


class Doc:
    def __init__(self, data, path):
        self.data, self.path = data, path
    def get(self, transaction=None):
        return Snap(self.data.get(self.path), self.path[2])


class Collection:
    def __init__(self, data, uid, name):
        self.data, self.uid, self.name = data, uid, name
    def document(self, identifier):
        return Doc(self.data, (self.uid, self.name, identifier))


class Root:
    def __init__(self, data, uid):
        self.data, self.uid = data, uid
    def collection(self, name):
        return Collection(self.data, self.uid, name)


class Tr:
    def __init__(self, data):
        self.data = data
    def delete(self, ref):
        self.data.pop(ref.path, None)
    def create(self, ref, value):
        assert ref.path not in self.data
        self.data[ref.path] = deepcopy(value)


def setup(monkeypatch):
    data = {
        ("A", "transactions", "purchase"): {
            "id": "purchase", "name": "Compra", "user_id": "A",
            "status": "pago", "type": "despesa", "date": "2026-10-03",
            "account_id": "bank", "version": 4, "value_cents": 10000,
        },
        ("B", "transactions", "other"): {
            "id": "other", "user_id": "B", "version": 2,
        },
    }
    events = []
    monkeypatch.setattr(store, "scoped", lambda q: q["user_id"])
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Root(data, uid))
    monkeypatch.setattr(store, "rows", lambda db, uid, name, tr=None: [
        dict(store.decode(doc), id=key[2], user_id=uid)
        for key, doc in data.items() if key[0] == uid and key[1] == name
    ])
    monkeypatch.setattr(store, "atomic", lambda db, uid, action: action(Tr(data)))
    monkeypatch.setattr(store, "validate_refs", lambda *args, **kw: None)
    monkeypatch.setattr(store, "record_event", lambda tr, rt, kind, action, before, after:
                        events.append((rt.uid, kind, action, before["id"])))
    return data, events


def delete(uid="A", ident="purchase", operation="op-1", version=4):
    q = {"id": ident, "user_id": uid}
    if operation is not None:
        q["_operation_id"] = operation
    if version is not None:
        q["_expected_version"] = version
    return asyncio.run(store.db.transactions.delete_one(q))


def test_lost_response_retries_only_one_original_delete(monkeypatch):
    data, events = setup(monkeypatch)
    assert delete().deleted_count == 1
    assert ("A", "transactions", "purchase") not in data
    assert delete().deleted_count == 1
    assert events == [("A", "transactions", "deleted", "purchase")]


def test_conflicting_version_fails_before_deleting(monkeypatch):
    data, events = setup(monkeypatch)
    with pytest.raises(HTTPException) as err:
        delete(version=3)
    assert err.value.status_code == 409
    assert ("A", "transactions", "purchase") in data
    assert events == []


def test_reused_operation_id_for_different_target_is_a_conflict(monkeypatch):
    data, _ = setup(monkeypatch)
    assert delete().deleted_count == 1
    with pytest.raises(HTTPException) as err:
        delete(ident="another-record")
    assert err.value.status_code == 409


def test_account_isolation_no_cross_uid_delete(monkeypatch):
    data, events = setup(monkeypatch)
    assert delete(uid="B", ident="purchase", operation="op-b", version=4).deleted_count == 0
    assert ("A", "transactions", "purchase") in data
    assert events == []


def test_original_online_contract_without_operation_id(monkeypatch):
    data, events = setup(monkeypatch)
    assert delete(operation=None, version=None).deleted_count == 1
    assert delete(operation=None, version=None).deleted_count == 0
    assert len(events) == 1
