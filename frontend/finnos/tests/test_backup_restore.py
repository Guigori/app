"""Restore: only into an empty account, checksum-verified, categories reused by name."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.routers import backup


class Store:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.inserted = []

    def find(self, query):
        rows = [r for r in self.rows + self.inserted if r.get("user_id") == query["user_id"]]
        return SimpleNamespace(to_list=lambda maximum: asyncio.sleep(0, result=rows[:maximum]))

    async def insert_one(self, doc):
        self.inserted.append(doc)


def make_db(**existing):
    names = set(backup.COLLECTIONS) | set(backup.RESTORE_MUST_BE_EMPTY)
    return SimpleNamespace(**{n: Store(existing.get(n)) for n in names})


def payload(collections):
    full = {n: collections.get(n, []) for n in backup.COLLECTIONS}
    return {"format": "finnos-backup", "version": 1, "collections": full, "checksum_sha256": backup.checksum(full)}


def test_restores_into_empty_account_reusing_default_categories(monkeypatch):
    fake = make_db(categories=[{"id": "def-merc", "user_id": "u", "name": "Mercado"}])
    monkeypatch.setattr(backup, "db", fake)
    data = payload({
        "accounts": [{"id": "a1", "name": "Banco"}],
        "categories": [{"id": "old-merc", "name": "mercado"}, {"id": "c2", "name": "Pets"}],
        "transactions": [{"id": "t1", "account_id": "a1", "category_id": "old-merc", "value": 10}],
    })
    out = asyncio.run(backup.restore_backup(data, user={"id": "u"}))
    assert out == {"restored": {**{n: 0 for n in backup.COLLECTIONS}, "accounts": 1, "categories": 1, "transactions": 1}, "reused_categories": 1}
    assert fake.transactions.inserted[0] == {"id": "t1", "account_id": "a1", "category_id": "def-merc", "value": 10, "user_id": "u"}
    assert [c["id"] for c in fake.categories.inserted] == ["c2"]


def test_refuses_an_account_that_already_has_data(monkeypatch):
    monkeypatch.setattr(backup, "db", make_db(accounts=[{"id": "x", "user_id": "u"}]))
    with pytest.raises(HTTPException) as error:
        asyncio.run(backup.restore_backup(payload({"accounts": [{"id": "a1"}]}), user={"id": "u"}))
    assert error.value.status_code == 409


def test_refuses_a_tampered_file(monkeypatch):
    monkeypatch.setattr(backup, "db", make_db())
    data = payload({"accounts": [{"id": "a1", "initial_balance": 10}]})
    data["collections"]["accounts"][0]["initial_balance"] = 999
    with pytest.raises(HTTPException) as error:
        asyncio.run(backup.restore_backup(data, user={"id": "u"}))
    assert error.value.status_code == 400


def test_checksum_survives_the_json_round_trip_of_real_firestore_values(monkeypatch):
    """Firestore returns datetimes and Decimals; the downloaded file has strings/numbers."""
    import json
    from datetime import datetime, timezone
    from decimal import Decimal

    rows = {name: [] for name in backup.COLLECTIONS}
    rows["accounts"] = [backup._clean({"id": "a1", "user_id": "u", "created_at": datetime(2026, 11, 5, 1, 36, 59, 123456, tzinfo=timezone.utc), "initial_balance": Decimal("120.50")})]
    exported = {"format": "finnos-backup", "version": 1, "collections": rows, "checksum_sha256": backup.checksum(rows)}
    downloaded = json.loads(json.dumps(exported))  # what the browser saves and later uploads
    assert downloaded["checksum_sha256"] == backup.checksum(downloaded["collections"])
