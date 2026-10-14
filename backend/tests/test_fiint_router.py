"""Contract tests for the canonical FIINT route without database calls."""
import asyncio
from datetime import date

import pytest
from fastapi import HTTPException

from routers import fiint


def test_fiint_returns_canonical_engine_and_empty_list(monkeypatch):
    async def empty_build(user_id, as_of, limit):
        assert user_id == "user-a"
        assert limit == 7
        return []

    monkeypatch.setattr(fiint, "_build", empty_build)
    monkeypatch.setattr(fiint, "financial_today", lambda: date(2026, 10, 14))
    result = asyncio.run(fiint.analyses(limit=7, user={"id": "user-a"}))
    assert result == {
        "engine": "FIINT", "version": "1.0", "as_of": "2026-10-14",
        "analyses": [], "count": 0,
    }


def test_fiint_detail_does_not_leak_missing_analysis(monkeypatch):
    async def empty_build(user_id, as_of, limit):
        assert user_id == "user-b"
        assert limit is None
        return []

    monkeypatch.setattr(fiint, "_build", empty_build)
    monkeypatch.setattr(fiint, "financial_today", lambda: date(2026, 10, 14))
    with pytest.raises(HTTPException) as error:
        asyncio.run(fiint.analysis_detail("another-users-id", user={"id": "user-b"}))
    assert error.value.status_code == 404
