"""Tests for the Firestore adapter used by the Vercel application."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from finnos.lib import db as adapter


def _with_uid():
    token = adapter.active_uid.set("uid-alpha")
    return token


def test_query_does_not_silently_truncate_transactions(monkeypatch):
    token = _with_uid()
    try:
        monkeypatch.setattr(adapter, "client", lambda: object())
        monkeypatch.setattr(adapter, "rows", lambda db, uid, kind: [
            {"id": str(i), "user_id": uid} for i in range(3)
        ])
        with pytest.raises(HTTPException) as error:
            asyncio.run(adapter.db.transactions.find({"user_id": "uid-alpha"}).to_list(2))
        assert error.value.status_code == 413
    finally:
        adapter.active_uid.reset(token)


def test_recent_previews_are_explicitly_bounded(monkeypatch):
    token = _with_uid()
    try:
        monkeypatch.setattr(adapter, "client", lambda: object())
        monkeypatch.setattr(adapter, "rows", lambda db, uid, kind: [
            {"id": str(i), "user_id": uid, "date": f"2026-10-{i:02d}"}
            for i in range(1, 11)
        ])
        query = adapter.db.transactions.find({"user_id": "uid-alpha"})
        with pytest.raises(HTTPException) as error:
            asyncio.run(query.to_list(6))
        assert error.value.status_code == 413
        assert len(asyncio.run(query.to_list(6, allow_truncate=True))) == 6
        assert len(asyncio.run(query.to_list(8, allow_truncate=True))) == 8
    finally:
        adapter.active_uid.reset(token)


def _mock_delete(monkeypatch, records):
    monkeypatch.setattr(adapter, "client", lambda: object())
    monkeypatch.setattr(adapter, "atomic", lambda db, uid, action: action(SimpleNamespace()))
    monkeypatch.setattr(
        adapter, "rows",
        lambda db, uid, kind, transaction=None: records.get(kind, [])
    )


def test_account_with_goal_cannot_be_deleted(monkeypatch):
    token = _with_uid()
    try:
        _mock_delete(monkeypatch, {
            "accounts": [{"id": "account-1", "user_id": "uid-alpha"}],
            "transactions": [],
            "cards": [],
            "goals": [{"id": "goal-1", "user_id": "uid-alpha", "account": "account-1"}],
        })
        with pytest.raises(HTTPException) as error:
            asyncio.run(adapter.db.accounts.delete_one(
                {"user_id": "uid-alpha", "id": "account-1"}
            ))
        assert error.value.status_code == 409
        assert "metas" in str(error.value.detail).lower()
    finally:
        adapter.active_uid.reset(token)


def test_category_used_by_budget_cannot_be_deleted(monkeypatch):
    token = _with_uid()
    try:
        _mock_delete(monkeypatch, {
            "categories": [{"id": "food", "user_id": "uid-alpha"}],
            "transactions": [],
            "budget_cycles": [{"id": "budget-1", "user_id": "uid-alpha",
                "allocations": [{"category_id": "food", "planned": 100}]}],
        })
        with pytest.raises(HTTPException) as error:
            asyncio.run(adapter.db.categories.delete_one(
                {"user_id": "uid-alpha", "id": "food"}
            ))
        assert error.value.status_code == 409
        assert "orçamento" in str(error.value.detail).lower()
    finally:
        adapter.active_uid.reset(token)


def test_mismatched_uid_is_denied():
    token = _with_uid()
    try:
        with pytest.raises(HTTPException) as error:
            adapter.db.transactions.find({"user_id": "uid-beta"})
        assert error.value.status_code == 403
    finally:
        adapter.active_uid.reset(token)


@pytest.mark.parametrize("kind, field, identifier", [
    ("accounts", "account_id", "account-1"),
    ("categories", "category_id", "category-1"),
    ("cards", "card_id", "card-1"),
])
def test_subscription_prevents_removing_referenced_resource(monkeypatch, kind, field, identifier):
    token = _with_uid()
    try:
        records = {
            kind: [{"id": identifier, "user_id": "uid-alpha"}],
            "transactions": [], "cards": [],
            "goals": [], "budget_cycles": [],
            "subscriptions": [{"id": "sub-1", "user_id": "uid-alpha",
                               field: identifier}],
        }
        if kind == "cards":
            records["cards"] = [{"id": identifier, "user_id": "uid-alpha"}]
        _mock_delete(monkeypatch, records)
        with pytest.raises(HTTPException) as error:
            asyncio.run(getattr(adapter.db, kind).delete_one(
                {"user_id": "uid-alpha", "id": identifier}
            ))
        assert error.value.status_code == 409
        assert "assinatura" in str(error.value.detail).lower()
    finally:
        adapter.active_uid.reset(token)
