"""Pure replay gates for a certified emulator-only financial outbox."""
from copy import deepcopy
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib import finance_shadow_outbox as outbox
from finnos.lib.finance_shadow_replay import replay_shadow_events
from finnos.lib.monthly_aggregate_shadow import IncrementalMonthlyLedger


class Tx:
    def __init__(self):
        self.item = None
    def create(self, ref, payload):
        self.item = payload


class Parent:
    def collection(self, key):
        assert key == "_finance_shadow_outbox_v1"
        return self
    def document(self, identifier):
        return identifier


def purchase(amount, category="food"):
    return {
        "id": "tx", "user_id": "test-owner",
        "date": "2026-10-21", "type": "despesa",
        "status": "pago", "value": Decimal(amount),
        "category_id": category, "account_id": "bank",
    }


def envelope(monkeypatch, revision, event=None):
    monkeypatch.setenv("FINNOS_SHADOW_OUTBOX_MODE", "emulator")
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8089")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-finnos")
    token = outbox.begin("test-owner", revision - 1)
    try:
        if event:
            outbox.capture_event(*event)
        txn = Tx()
        outbox.finish(txn, Parent(), revision - 1)
        return txn.item
    finally:
        outbox.end(token)


def seed():
    return IncrementalMonthlyLedger().snapshot(0, source_count=0)


def test_emulator_replay_create_edit_delete_and_retry(monkeypatch):
    before = purchase("12.34")
    after = purchase("8.90", category="transport")
    events = [
        envelope(monkeypatch, 1, ("transactions", "created", None, before)),
        envelope(monkeypatch, 2, ("transactions", "updated", before, after)),
        envelope(monkeypatch, 3),  # idempotent HTTP replay: finance revision still advances
        envelope(monkeypatch, 4, ("transactions", "deleted", after, None)),
    ]
    one = replay_shadow_events(seed(), events[:1],
                               user_id="test-owner", target_revision=1)
    assert one["months"]["2026-10"]["expense_cents"] == 1234
    assert one["source_count"] == 1
    assert one["production_eligible"] is False
    two = replay_shadow_events(seed(), events[:2],
                               user_id="test-owner", target_revision=2)
    assert two["months"]["2026-10"]["expense_cents"] == 890
    assert two["months"]["2026-10"]["categories_cents"] == {"transport": 890}
    assert two["source_count"] == 1
    result = replay_shadow_events(seed(), events,
                                  user_id="test-owner", target_revision=4)
    assert result["months"] == {}
    assert result["source_count"] == 0


def test_replay_never_falls_back_silently_on_missing_revisions(monkeypatch):
    first = envelope(monkeypatch, 1, ("transactions", "created", None, purchase("10.00")))
    second = envelope(monkeypatch, 2)
    for entries, target in [
        ([second], 2),
        ([first], 2),
        ([first, first], 2),
    ]:
        with pytest.raises(HTTPException) as blocked:
            replay_shadow_events(seed(), entries,
                                 user_id="test-owner", target_revision=target)
        assert blocked.value.status_code == 409

    swapped_uid = {**first, "user_id": "test-another"}
    with pytest.raises(HTTPException) as isolated:
        replay_shadow_events(seed(), [swapped_uid],
                             user_id="test-owner", target_revision=1)
    assert isolated.value.status_code == 409


def test_card_credit_requires_full_rebuild_even_after_valid_transactions(monkeypatch):
    first = envelope(monkeypatch, 1, ("transactions", "created", None, purchase("10")))
    card = envelope(
        monkeypatch, 2, (
            "cards", "updated",
            {"id": "card", "name": "Card"},
            {"id": "card", "credit_amount": Decimal("5")},
        ),
    )
    with pytest.raises(HTTPException, match="reconstrução"):
        replay_shadow_events(seed(), [first, card],
                             user_id="test-owner", target_revision=2)


def test_tampering_and_unsafe_mode_fail_closed(monkeypatch):
    first = envelope(monkeypatch, 1, ("transactions", "created", None, purchase("10")))
    altered = deepcopy(first)
    altered["is_noop"] = True
    with pytest.raises(HTTPException) as fail:
        replay_shadow_events(seed(), [altered],
                             user_id="test-owner", target_revision=1)
    assert fail.value.status_code == 409
    bad_seed = seed()
    bad_seed["source_count"] = 1
    with pytest.raises(HTTPException):
        replay_shadow_events(bad_seed, [first],
                             user_id="test-owner", target_revision=1)
    with pytest.raises(HTTPException):
        replay_shadow_events(seed(), [first],
                             user_id="real-uid", target_revision=1)
