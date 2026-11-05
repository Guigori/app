"""Preferences: only known keys, bounded size, stored per user. No financial data."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.routers import preferences


def test_round_trip_and_validation(monkeypatch):
    docs = {}

    class Doc:
        def __init__(self, uid):
            self.uid = uid

        def get(self):
            return SimpleNamespace(exists=self.uid in docs, to_dict=lambda: docs.get(self.uid))

        def set(self, data, merge=False):
            docs[self.uid] = {**docs.get(self.uid, {}), **data}

    monkeypatch.setattr(preferences, "_doc", lambda uid: Doc(uid))
    monkeypatch.setattr(preferences, "run_in_threadpool", lambda fn: asyncio.sleep(0, result=fn()))
    me = {"id": "u1"}
    asyncio.run(preferences.save_preferences(preferences.PreferencesIn(values={"register_default": "inteligente"}), user=me))
    assert asyncio.run(preferences.read_preferences(user=me))["values"] == {"register_default": "inteligente"}
    assert asyncio.run(preferences.read_preferences(user={"id": "u2"}))["values"] == {}
    for bad in ({"saldo": "1"}, {"home": "x" * 5000}):
        with pytest.raises(HTTPException) as error:
            asyncio.run(preferences.save_preferences(preferences.PreferencesIn(values=bad), user=me))
        assert error.value.status_code == 422
