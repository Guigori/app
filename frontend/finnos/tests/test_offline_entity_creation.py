"""SYNC-02: account, category, card and subscription creates are replay-safe.

The actual db.Collection.insert_one is exercised with an in-memory UID-scoped
Firestore transaction; no service account, secrets or production writes.
"""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.lib import db as store


class Snapshot:
    def __init__(self, value):
        self.exists = value is not None
        self.value = deepcopy(value)
    def to_dict(self):
        return deepcopy(self.value)


class Ref:
    def __init__(self, records, key):
        self.records, self.key = records, key
    def get(self, transaction=None):
        return Snapshot(self.records.get(self.key))


class Root:
    def __init__(self, records, uid):
        self.records, self.uid = records, uid
    def collection(self, name):
        return SimpleNamespace(document=lambda key: Ref(self.records, (self.uid, name, key)))


class Transaction:
    def __init__(self, records):
        self.records = records
    def create(self, ref, value):
        assert ref.key not in self.records
        self.records[ref.key] = deepcopy(value)


@pytest.mark.parametrize("kind", ["accounts", "categories", "cards", "subscriptions"])
def test_operation_id_yields_same_record_once_after_lost_http_response(kind, monkeypatch):
    records, events = {}, []
    monkeypatch.setattr(store, "scoped", lambda row: row["user_id"])
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Root(records, uid))
    monkeypatch.setattr(store, "atomic", lambda db, uid, fn: fn(Transaction(records)))
    monkeypatch.setattr(store, "validate_refs", lambda *args, **kwargs: None)
    monkeypatch.setattr(store, "record_event", lambda tr, rt, name, action, before, after:
                        events.append((rt.uid, name, action, after["id"])))
    async def insert(data):
        await getattr(store.db, kind).insert_one(data)

    initial = {"user_id": "A", "operation_id": "offline-operation-1", "name": "Teste",
               "id": "client-random", "created_at": datetime(2026, 10, 1, tzinfo=timezone.utc)}
    asyncio.run(insert(initial))
    stable_id = initial["id"]
    retry = {**initial, "id": "another-random",
             "created_at": datetime(2026, 10, 2, tzinfo=timezone.utc)}
    asyncio.run(insert(retry))
    assert retry["id"] == stable_id
    assert len([key for key in records if key[1] == kind]) == 1
    assert len(events) == 1
    with pytest.raises(HTTPException) as err:
        asyncio.run(insert({**initial, "id": "third-random", "name": "Different"}))
    assert err.value.status_code == 409
    assert len(events) == 1


def test_account_draft_operation_cannot_replay_in_another_uid(monkeypatch):
    records = {}
    monkeypatch.setattr(store, "scoped", lambda row: row["user_id"])
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Root(records, uid))
    monkeypatch.setattr(store, "atomic", lambda db, uid, fn: fn(Transaction(records)))
    monkeypatch.setattr(store, "validate_refs", lambda *args, **kwargs: None)
    monkeypatch.setattr(store, "record_event", lambda *args, **kwargs: None)

    async def insert(uid):
        row = {"id": "ignored", "user_id": uid, "name": "Banco",
               "operation_id": "same-client-operation"}
        await store.db.accounts.insert_one(row)
        return row["id"]

    a, b = asyncio.run(insert("A")), asyncio.run(insert("B"))
    assert a != b
    assert len([key for key in records if key[1] == "accounts"]) == 2
