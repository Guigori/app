"""FIN-01/05 and ARQ-02: invoice write-path reads are transaction-scoped.

The query must exclude unrelated card purchases and bank debits, remain
UID-scoped, and fail closed on malformed records or >20k matching purchases.
"""
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib import db as store


class Snapshot:
    def __init__(self, identifier, data):
        self.id, self.data = identifier, data

    def to_dict(self):
        return self.data


class Query:
    def __init__(self, rows, calls):
        self.rows, self.calls = rows, calls

    def limit(self, max_items):
        assert max_items == 20001
        self.calls.append(("limit", max_items))
        return self

    def stream(self, *, transaction, timeout):
        self.calls.append(("stream", transaction, timeout))
        return iter(self.rows[:20001])


class Collection:
    def __init__(self, records, calls):
        self.records, self.calls = records, calls

    def where(self, field, comparator, identifier):
        self.calls.append(("where", field, comparator, identifier))
        assert (field, comparator) == ("card_id", "==")
        return Query(self.records.get(identifier, []), self.calls)


def configure(monkeypatch, records):
    calls = []
    collection = Collection(records, calls)

    class Root:
        def collection(self, name):
            assert name == "transactions"
            return collection

    monkeypatch.setattr(store, "root", lambda instance, uid: Root())
    token = store.active_uid.set("uid-test")
    return calls, token


def test_only_target_card_is_read_inside_existing_transaction(monkeypatch):
    records = {
        "card": [
            Snapshot("old", {
                "date": "2025-01-15", "card_id": "card", "value_cents": 1234,
            }),
            Snapshot("future", {
                "date": "2026-10-20", "card_id": "card", "value_cents": 1,
            }),
        ],
        "other": [Snapshot("secret", {
            "date": "2026-10-20", "card_id": "other", "value_cents": 700000,
        })],
    }
    calls, token = configure(monkeypatch, records)
    try:
        tr = object()
        result = store.card_purchase_rows(object(), "uid-test", "card", tr)
        assert [x["id"] for x in result] == ["old", "future"]
        assert result[0]["value"] == Decimal("12.34")
        assert calls == [
            ("where", "card_id", "==", "card"),
            ("limit", 20001),
            ("stream", tr, 15),
        ]
    finally:
        store.active_uid.reset(token)


def test_atomic_invoice_read_fails_closed_beyond_existing_limit(monkeypatch):
    records = {"card": [
        Snapshot(f"purchase-{i}", {"card_id": "card", "value_cents": 1})
        for i in range(20001)
    ]}
    _, token = configure(monkeypatch, records)
    try:
        with pytest.raises(HTTPException) as exc:
            store.card_purchase_rows(object(), "uid-test", "card", object())
        assert exc.value.status_code == 413
    finally:
        store.active_uid.reset(token)


def test_invoice_write_rejects_cross_user_card_and_corrupted_purchase(monkeypatch):
    _, token = configure(monkeypatch, {
        "card": [Snapshot("bad", {"card_id": "other", "value_cents": 1})]
    })
    try:
        with pytest.raises(HTTPException) as wrong:
            store.card_purchase_rows(object(), "uid-test", "card", object())
        assert wrong.value.status_code == 503
        with pytest.raises(HTTPException) as denied:
            store.card_purchase_rows(object(), "another-uid", "card", object())
        assert denied.value.status_code == 403
    finally:
        store.active_uid.reset(token)
