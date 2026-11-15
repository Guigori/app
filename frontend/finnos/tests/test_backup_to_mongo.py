"""scripts/backup_to_mongo.py with an in-memory stand-in for MongoDB and the export API: it must never write to the
historical database, verify every checksum, skip unchanged users and keep only the newest copies."""
import base64
import gzip
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("backup_to_mongo", ROOT / "scripts/backup_to_mongo.py")
job = importlib.util.module_from_spec(spec)
spec.loader.exec_module(job)


class Collection:
    def __init__(self):
        self.docs = {}

    def insert_one(self, doc):
        assert doc["_id"] not in self.docs
        self.docs[doc["_id"]] = dict(doc)

    def create_index(self, *a, **k):
        pass

    def aggregate(self, pipeline):
        newest = {}
        for doc in sorted(self.docs.values(), key=lambda d: d["created_at"], reverse=True):
            newest.setdefault(doc["uid"], doc["revision"])
        return [{"_id": uid, "revision": rev} for uid, rev in newest.items()]

    def find(self, query, projection=None):
        rows = [d for d in self.docs.values() if all(d.get(k) == v for k, v in query.items())]

        class Cursor:
            def sort(self, key, direction):
                rows.sort(key=lambda d: d[key], reverse=direction == -1)
                return self

            def skip(self, n):
                return rows[n:]

        return Cursor()

    def delete_many(self, query):
        for key in query["_id"]["$in"]:
            self.docs.pop(key, None)


class Database(dict):
    def __missing__(self, name):
        self[name] = Collection()
        return self[name]

    def list_collection_names(self):
        return list(self)


class Client(dict):
    def __missing__(self, name):
        self[name] = Database()
        return self[name]


def item(uid, revision, collections):
    data = {"checksum_sha256": job.checksum(collections), "collections": collections}
    return {"uid": uid, "revision": revision, "exported_at": "2026-11-16T07:20:00+00:00", "counts": {},
            "checksum_sha256": data["checksum_sha256"],
            "gzip_b64": base64.b64encode(gzip.compress(json.dumps(data).encode())).decode()}


@pytest.fixture
def mongo(monkeypatch):
    client = Client()
    fake = types.ModuleType("pymongo")
    fake.ASCENDING, fake.DESCENDING = 1, -1
    fake.MongoClient = lambda url, **k: client
    monkeypatch.setitem(sys.modules, "pymongo", fake)
    monkeypatch.setenv("MONGO_URL", "mongodb://synthetic")
    monkeypatch.setenv("FINNOS_CRON_SECRET", "s" * 20)
    monkeypatch.delenv("BACKUP_DB_NAME", raising=False)
    monkeypatch.setenv("DB_NAME", "finnos_historico")
    return client


def test_copies_verifies_and_skips_unchanged(mongo, monkeypatch):
    sent = []
    pages = [{"items": [item("a", 3, {"transactions": [{"id": "t1"}]}), item("b", 1, {})], "next": "b"},
             {"items": [{"uid": "c", "revision": 2, "unchanged": True}], "next": None}]
    monkeypatch.setattr(job, "fetch_page", lambda secret, after, known: (sent.append((after, dict(known))), pages.pop(0))[1])
    job.main()
    copies = mongo["finnos_backup"]["snapshots"].docs
    assert sorted(d["uid"] for d in copies.values()) == ["a", "b"]
    assert "finnos_historico" not in mongo
    assert sent[0] == (None, {}) and sent[1][0] == "b"


def test_bad_checksum_fails_and_is_not_stored(mongo, monkeypatch):
    broken = item("a", 3, {"transactions": [{"id": "t1"}]})
    broken["checksum_sha256"] = "0" * 64
    monkeypatch.setattr(job, "fetch_page", lambda *a: {"items": [broken], "next": None})
    with pytest.raises(SystemExit):
        job.main()
    assert not mongo["finnos_backup"]["snapshots"].docs


def test_never_writes_to_the_historical_database(mongo, monkeypatch):
    monkeypatch.setenv("BACKUP_DB_NAME", "finnos_historico")
    with pytest.raises(SystemExit, match="histórico"):
        job.main()
    mongo["finnos_old"]["transactions"].insert_one({"_id": "x"})
    monkeypatch.setenv("BACKUP_DB_NAME", "finnos_old")
    with pytest.raises(SystemExit, match="não é um banco de backup"):
        job.main()
    assert list(mongo["finnos_old"]) == ["transactions"]


def test_keeps_only_the_newest_copies(mongo, monkeypatch):
    monkeypatch.setattr(job, "KEEP", 2)
    from datetime import datetime, timedelta, timezone
    copies = mongo["finnos_backup"]["snapshots"]
    mongo["finnos_backup"][job.MARKER].insert_one({"_id": "marker"})
    for n in range(3):
        copies.insert_one({"_id": f"a:{n}", "uid": "a", "revision": n,
                           "created_at": datetime(2026, 11, 1, tzinfo=timezone.utc) + timedelta(days=n)})
    monkeypatch.setattr(job, "fetch_page", lambda *a: {"items": [item("a", 9, {})], "next": None})
    job.main()
    assert len([d for d in copies.docs.values() if d["uid"] == "a"]) == 2


def test_without_secrets_the_job_is_skipped(monkeypatch, capsys):
    monkeypatch.delenv("MONGO_URL", raising=False)
    job.main()
    assert "pulado" in capsys.readouterr().out


def test_export_route_requires_the_cron_secret(monkeypatch):
    from fastapi.testclient import TestClient
    from api import index as api
    monkeypatch.setenv("CRON_SECRET", "c" * 24)
    client = TestClient(api.app)
    assert client.post("/api/finance/backups-export", json={}).status_code == 401
    assert client.post("/api/finance/backups-export", json={},
                       headers={"Authorization": "Bearer " + "x" * 24}).status_code == 401
