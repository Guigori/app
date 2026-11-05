"""Fase 1: complete, UID-scoped, consistent backup. Synthetic data only."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.routers import backup


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query):
        assert query == {"user_id": "test-user"}
        return SimpleNamespace(to_list=self._to_list)

    async def _to_list(self, maximum):
        return list(self.rows)


def setup(monkeypatch, revisions):
    data = {name: Rows([]) for name in backup.COLLECTIONS}
    data["accounts"] = Rows([{"id": "a1", "user_id": "test-user", "name": "Banco", "initial_balance": 10}])
    data["ai_keys"] = Rows([{"id": "k", "user_id": "test-user", "secret": "never"}])
    monkeypatch.setattr(backup, "db", SimpleNamespace(**data))
    seq = iter(revisions)

    async def revision(uid):
        return next(seq)

    monkeypatch.setattr(backup, "finance_revision", revision)
    monkeypatch.setattr(backup, "run_in_threadpool", lambda fn: asyncio.sleep(0, result=None))


def test_backup_is_versioned_complete_and_never_contains_secrets_or_owner(monkeypatch):
    setup(monkeypatch, [7, 7])
    out = asyncio.run(backup.export_backup(user={"id": "test-user"}))
    assert out["format"] == "finnos-backup" and out["version"] == 1
    assert out["counts"]["accounts"] == 1
    assert out["collections"]["accounts"][0] == {"id": "a1", "name": "Banco", "initial_balance": 10}
    assert "ai_keys" not in out["collections"]
    assert out["checksum_sha256"] == backup.checksum(out["collections"])


def test_concurrent_write_refuses_a_mixed_snapshot(monkeypatch):
    setup(monkeypatch, [7, 8])
    with pytest.raises(HTTPException) as error:
        asyncio.run(backup.export_backup(user={"id": "test-user"}))
    assert error.value.status_code == 409
