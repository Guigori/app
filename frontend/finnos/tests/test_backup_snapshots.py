"""Weekly server copies: split/compress round trip, retention, checksum and cron auth. Synthetic data."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.routers import backup


class Doc:
    def __init__(self, store, path):
        self.store, self.path, self.id = store, path, path.split("/")[-1]

    def set(self, data):
        self.store[self.path] = dict(data)

    def get(self):
        return SimpleNamespace(exists=self.path in self.store, to_dict=lambda: self.store.get(self.path))

    def delete(self):
        self.store.pop(self.path, None)

    def collection(self, name):
        return Col(self.store, f"{self.path}/{name}")


class Col:
    def __init__(self, store, path):
        self.store, self.path = store, path

    def document(self, doc_id):
        return Doc(self.store, f"{self.path}/{doc_id}")

    def _children(self):
        prefix = self.path + "/"
        ids = {k[len(prefix):].split("/")[0] for k in self.store if k.startswith(prefix)}
        return [Doc(self.store, prefix + i) for i in sorted(ids)]

    def list_documents(self, page_size=None):
        return self._children()

    def stream(self, timeout=None):
        return [SimpleNamespace(id=d.id, to_dict=(lambda d=d: self.store.get(d.path))) for d in self._children() if d.path in self.store]


@pytest.fixture
def fake(monkeypatch):
    store = {}
    monkeypatch.setattr(backup, "_snapshots", lambda uid: Col(store, f"users/{uid}/backup_snapshots"))
    monkeypatch.setattr(backup, "run_in_threadpool", lambda fn: asyncio.sleep(0, result=fn()))
    counter = iter(range(100))

    async def build(uid):
        collections = {"accounts": [{"id": "a1", "name": "Banco"}], "transactions": [{"id": f"t{i}", "name": "x" * 50} for i in range(2000)]}
        return {"format": "finnos-backup", "version": 1, "exported_at": f"2026-11-0{1}T00:00:{next(counter):02d}+00:00", "counts": {k: len(v) for k, v in collections.items()}, "checksum_sha256": backup.checksum(collections), "collections": collections}

    monkeypatch.setattr(backup, "build_backup", build)
    return store


def test_encode_decode_round_trip_splits_large_payloads(monkeypatch):
    monkeypatch.setattr(backup, "SNAPSHOT_PART", 100)
    data = {"collections": {"transactions": [{"id": str(i)} for i in range(200)]}}
    parts = backup.encode_snapshot(data)
    assert len(parts) > 1 and all(len(p) <= 100 for p in parts)
    assert backup.decode_snapshot(parts) == data


def test_saves_lists_downloads_and_keeps_only_the_newest(fake, monkeypatch):
    ids = []
    for i in range(10):
        monkeypatch.setattr(backup, "datetime", type("D", (), {"now": staticmethod(lambda tz=None, i=i: __import__("datetime").datetime(2026, 11, 1, 0, 0, i, tzinfo=tz)), "fromisoformat": staticmethod(__import__("datetime").datetime.fromisoformat)}))
        ids.append(asyncio.run(backup.save_snapshot("u", "semanal"))["id"])
    listed = asyncio.run(backup.list_snapshots(user={"id": "u"}))["items"]
    assert [r["id"] for r in listed] == sorted(ids, reverse=True)[: backup.SNAPSHOT_KEEP]
    restored = asyncio.run(backup.download_snapshot(listed[0]["id"], user={"id": "u"}))
    assert restored["counts"] == {"accounts": 1, "transactions": 2000}


def test_a_tampered_copy_is_refused(fake):
    sid = asyncio.run(backup.save_snapshot("u", "manual"))["id"]
    part = f"users/u/backup_snapshots/{sid}/parts/0000"
    data = backup.decode_snapshot([fake[part]["data"]])
    data["collections"]["accounts"][0]["name"] = "Outro"
    fake[part]["data"] = backup.encode_snapshot(data)[0]
    with pytest.raises(HTTPException) as error:
        asyncio.run(backup.download_snapshot(sid, user={"id": "u"}))
    assert error.value.status_code == 409


def test_weekly_run_requires_the_cron_secret(monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "s" * 32)
    with pytest.raises(HTTPException) as error:
        asyncio.run(backup.run_weekly_snapshots(authorization="Bearer errado"))
    assert error.value.status_code == 401
