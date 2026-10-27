"""Actual local Firestore emulator proof for shadow outbox and reconciliation.

Must run with FIRESTORE_EMULATOR_HOST, FIREBASE_PROJECT_ID=demo-finnos and
FINNOS_SHADOW_OUTBOX_MODE=emulator. NEVER talks to finnos-app or live data.
"""
import asyncio
import os
from copy import deepcopy
from decimal import Decimal
from unittest.mock import patch
from google.auth.credentials import AnonymousCredentials

import pytest
from firebase_admin import firestore
import firebase_admin

from finnos.lib import db as store
from finnos.lib import finance_shadow_outbox as outbox
from finnos.lib.account_balances import finance_revision
from finnos.lib.monthly_aggregate_shadow_reads import (
    build_shadow_candidate, check_shadow_candidate,
)
from finnos.lib.monthly_aggregate_shadow import IncrementalMonthlyLedger
from finnos.lib.finance_shadow_replay import replay_shadow_events
from fastapi import HTTPException



@pytest.fixture
def cloud():
    if (os.environ.get("FIREBASE_PROJECT_ID") != "demo-finnos"
            or not os.environ.get("FIRESTORE_EMULATOR_HOST")
            or os.environ.get("FINNOS_SHADOW_OUTBOX_MODE") != "emulator"):
        pytest.skip("Somente no Firestore Emulator com projeto demo-finnos.")
    # Firebase Admin still requests ADC even with FIRESTORE_EMULATOR_HOST.
    # Supply ephemeral anonymous credentials ONLY inside this demo-only test.
    # No service account, ADC file or cloud credential is ever required.
    with patch("google.auth.default",
               return_value=(AnonymousCredentials(), "demo-finnos")):
        app = firebase_admin.initialize_app(
            options={"projectId": "demo-finnos"},
            name="shadow-outbox-emulator",
        )
        instance = firestore.client(app=app)
    token = store.active_uid.set("test-shadow-finance")
    try:
        yield instance
    finally:
        store.active_uid.reset(token)
        firebase_admin.delete_app(app)


def transact(instance, parent, action):
    revision_ref = parent.collection("_meta").document("finance")

    @firestore.transactional
    def run(transaction):
        snapshot = revision_ref.get(transaction=transaction)
        before = (snapshot.to_dict() or {}).get("revision", 0) if snapshot.exists else 0
        token = outbox.begin("test-shadow-finance", before)
        try:
            action(transaction)
            outbox.finish(transaction, parent, before)
            transaction.set(revision_ref, {"revision": before + 1})
            return before + 1
        finally:
            outbox.end(token)

    return run(instance.transaction(max_attempts=3))


def document(identifier, amount, category="shopping"):
    return {
        "id": identifier, "user_id": "test-shadow-finance",
        "name": identifier, "type": "despesa", "status": "pago",
        "date": "2026-09-20", "card_id": "card",
        "account_id": "bank", "category_id": category,
        "value": Decimal(amount), "installment": False,
    }


def test_emulator_outbox_revision_replay_credit_and_second_pass(cloud, monkeypatch):
    parent = store.root(cloud, "test-shadow-finance")
    purchase_ref = parent.collection("transactions").document("purchase")
    card_ref = parent.collection("cards").document("card")
    original = document("purchase", "300.00")
    adjusted = document("purchase", "330.31", "electronics")
    card = {"id": "card", "name": "Card", "invoice_adjustments": {}}

    def create(transaction):
        transaction.create(purchase_ref, store.encode(original))
        outbox.capture_event("transactions", "created", None, original)
    assert transact(cloud, parent, create) == 1

    def update(transaction):
        transaction.set(purchase_ref, store.encode(adjusted))
        outbox.capture_event("transactions", "updated", original, adjusted)
    assert transact(cloud, parent, update) == 2

    credited = deepcopy(card)
    credited["invoice_adjustments"] = {
        "2026-09-29": [{
            "id": "credit", "purchase_id": "purchase",
            "date": "2026-10-26", "credit_cents": 5000,
        }]
    }
    def adjust(transaction):
        transaction.set(card_ref, store.encode(credited))
        # Credit route currently emits a condensed audit summary. An outbox
        # consumer must fail-closed and REBUILD, not guess the category.
        outbox.capture_event("cards", "updated", card, credited)
    assert transact(cloud, parent, adjust) == 3

    # A replay with a previously acknowledged operation is a canonical no-op
    # but still advances the existing finance revision.
    assert transact(cloud, parent, lambda tr: None) == 4

    events = [
        parent.collection("_finance_shadow_outbox_v1")
        .document(f"{i:016d}").get().to_dict()
        for i in range(1, 5)
    ]
    assert [item["finance_revision"] for item in events] == [1, 2, 3, 4]
    assert all(item["status"] == "emulator_only" for item in events)
    assert events[0]["events"][0]["delta_months"]["2026-09"]["expense_cents"] == 30000
    assert events[1]["events"][0]["delta_months"]["2026-09"]["expense_cents"] == 3031
    assert events[2]["requires_rebuild"]
    assert events[3]["is_noop"]
    # Replay from an independently seeded empty revision is exact for simple
    # transaction changes; card credits MUST force a full rebuild instead.
    empty = IncrementalMonthlyLedger().snapshot(0, source_count=0)
    replayed = replay_shadow_events(
        empty, events[:2], user_id="test-shadow-finance", target_revision=2
    )
    assert replayed["source_count"] == 1
    assert replayed["months"]["2026-09"]["expense_cents"] == 33031
    with pytest.raises(HTTPException) as requires_rebuild:
        replay_shadow_events(
            empty, events, user_id="test-shadow-finance", target_revision=4
        )
    assert requires_rebuild.value.status_code == 409
    assert not list(parent.collection("_finance_month_shadows_v1").limit(1).stream())

    # Read-only rebuild; the independent second scan uses the actual
    # emulator-owned documents, not cached rows or a mocked Firestore cursor.
    monkeypatch.setattr(store, "client", lambda: cloud)
    cards = [dict(store.decode(card_ref.get().to_dict()), id="card",
                  user_id="test-shadow-finance")]
    revision = asyncio.run(finance_revision("test-shadow-finance"))
    assert revision == 4
    candidate = asyncio.run(build_shadow_candidate(
        "test-shadow-finance", cards, revision
    ))
    assert candidate["months"]["2026-09"]["expense_cents"] == 33031
    assert candidate["months"]["2026-10"]["expense_cents"] == -5000
    report = asyncio.run(check_shadow_candidate(
        "test-shadow-finance", cards, revision, candidate
    ))
    assert report["match"], report
    assert report["candidate_checksum"] == candidate["checksum"]
    assert report["production_eligible"] is False
    assert not list(parent.collection("_finance_month_shadows_v1").limit(1).stream())
