"""Emulator-only outbox gates and deterministic event deltas.

All Firestore objects in this unit test are fakes. Nothing touches production.
"""
from copy import deepcopy
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib import finance_shadow_outbox as outbox


class FakeTxn:
    def __init__(self):
        self.writes = []

    def create(self, ref, doc):
        self.writes.append((ref, deepcopy(doc)))


class FakeParent:
    def collection(self, name):
        assert name == "_finance_shadow_outbox_v1"
        return self

    def document(self, identifier):
        return identifier


@pytest.fixture
def emulator(monkeypatch):
    monkeypatch.setenv("FINNOS_SHADOW_OUTBOX_MODE", "emulator")
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8089")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-finnos")
    yield


def purchase(value="300.00", uid="test-owner", category="shopping"):
    return {
        "id": "purchase", "user_id": uid, "type": "despesa",
        "date": "2026-09-21", "status": "pago",
        "value": Decimal(value), "card_id": "card",
        "category_id": category,
    }


def test_default_mode_never_writes_and_emulator_gate_is_strict(monkeypatch):
    monkeypatch.delenv("FINNOS_SHADOW_OUTBOX_MODE", raising=False)
    assert outbox.begin("test-owner", 0) is None
    txn = FakeTxn()
    outbox.capture_event("transactions", "created", None, purchase())
    outbox.finish(txn, FakeParent(), 0)
    assert txn.writes == []

    monkeypatch.setenv("FINNOS_SHADOW_OUTBOX_MODE", "emulator")
    for field, value in (
        ("FIRESTORE_EMULATOR_HOST", ""),
        ("FIREBASE_PROJECT_ID", "finnos-app"),
        ("FIREBASE_PROJECT_ID", "demo-finnos"),
    ):
        monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8089")
        monkeypatch.setenv("FIREBASE_PROJECT_ID", "finnos-app")
        monkeypatch.setenv(field, value)
        with pytest.raises(HTTPException) as failure:
            outbox.begin("real-uid", 10)
        assert failure.value.status_code == 503


def test_multiple_transaction_changes_are_cent_exact_in_one_revision(emulator):
    tok = outbox.begin("test-owner", 7)
    try:
        outbox.capture_event("transactions", "created", None, purchase())
        before = purchase()
        after = purchase("320.31", category="electronics")
        outbox.capture_event("transactions", "updated", before, after)
        txn = FakeTxn()
        outbox.finish(txn, FakeParent(), 7)
    finally:
        outbox.end(tok)

    assert len(txn.writes) == 1
    ref, document = txn.writes[0]
    assert ref == "0000000000000008"
    assert document["previous_revision"] == 7
    assert document["finance_revision"] == 8
    assert document["user_id"] == "test-owner"
    assert not document["requires_rebuild"]
    assert len(document["events"]) == 2
    events = document["events"]
    assert events[0]["delta_months"]["2026-09"]["expense_cents"] == 30000
    assert events[1]["delta_months"]["2026-09"]["expense_cents"] == 2031
    assert events[1]["delta_months"]["2026-09"]["categories_cents"] == {
        "electronics": 32031, "shopping": -30000,
    }
    assert [e["source_count_delta"] for e in events] == [1, 0]
    assert not any("value" in str(key) for e in events for key in e)
    assert not outbox._capture.get()


def test_card_credit_forces_rebuild_and_noop_revision_is_preserved(emulator):
    token = outbox.begin("test-owner", 12)
    try:
        outbox.capture_event(
            "cards", "updated",
            {"id": "card", "name": "Card"},
            {"id": "card", "credit_amount": Decimal("50.00")},
        )
        txn = FakeTxn()
        outbox.finish(txn, FakeParent(), 12)
    finally:
        outbox.end(token)
    assert txn.writes[0][1]["requires_rebuild"] is True
    assert txn.writes[0][1]["events"][0]["delta_months"] == {}

    token = outbox.begin("test-owner", 13)
    try:
        noop = FakeTxn()
        outbox.finish(noop, FakeParent(), 13)
    finally:
        outbox.end(token)
    assert noop.writes[0][1]["is_noop"] is True
    assert noop.writes[0][1]["events"] == []


def test_foreign_owner_and_revision_mismatch_fail_closed(emulator):
    token = outbox.begin("test-owner", 15)
    try:
        with pytest.raises(HTTPException) as foreign:
            outbox.capture_event("transactions", "created", None, purchase(uid="other"))
        assert foreign.value.status_code == 503
        with pytest.raises(HTTPException) as revision:
            outbox.finish(FakeTxn(), FakeParent(), 16)
        assert revision.value.status_code == 409
    finally:
        outbox.end(token)


def test_failed_attempt_does_not_pollute_next_transaction(emulator):
    token = outbox.begin("test-owner", 4)
    try:
        outbox.capture_event("transactions", "created", None, purchase())
    finally:
        outbox.end(token)
    assert outbox._capture.get() is None
    next_token = outbox.begin("test-owner", 4)
    try:
        txn = FakeTxn()
        outbox.finish(txn, FakeParent(), 4)
        assert txn.writes[0][1]["events"] == []
    finally:
        outbox.end(next_token)
