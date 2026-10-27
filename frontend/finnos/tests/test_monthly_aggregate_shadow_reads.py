"""Synthetic pagination and second-pass reconciliation, no cloud credentials."""
import asyncio
from bisect import bisect_right
from copy import deepcopy
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib import db as store
from finnos.lib.account_balances import PAGE_SIZE, finance_revision
from finnos.lib.monthly_aggregate_shadow import snapshot_checksum
from finnos.lib.monthly_aggregate_shadow_reads import (
    build_shadow_candidate, check_shadow_candidate,
)


class Snapshot:
    def __init__(self, data, identifier=None):
        self.data = data
        self.id = identifier or data["id"]
        self.exists = True

    def to_dict(self):
        return dict(self.data)


class Query:
    def __init__(self, records, events):
        self.records = records
        self.ids = [r["id"] for r in records]
        self.events = events
        self.cursor = None
        self.size = 0

    def start_after(self, snap):
        self.cursor = snap.id
        return self

    def limit(self, size):
        assert size == PAGE_SIZE
        self.size = size
        return self

    def stream(self, timeout):
        assert timeout == 15
        self.events["pages"] += 1
        if self.events["change_at"] == self.events["pages"]:
            self.events["revision"] += 1
        ix = bisect_right(self.ids, self.cursor) if self.cursor else 0
        return iter(Snapshot(x) for x in self.records[ix:ix + self.size])


def fixture(monkeypatch, records):
    records.sort(key=lambda r: r["id"])
    events = {"revision": 15, "change_at": None, "pages": 0}

    class Parent:
        def collection(self, name):
            if name == "_meta":
                return type("Meta", (), {"document": lambda self, name: type(
                    "Ref", (), {"get": lambda self: Snapshot(
                        {"revision": events["revision"]}, "finance",
                    )})()})()
            assert name == "transactions"
            return type("Transactions", (), {
                "order_by": lambda self, key: Query(records, events)
            })()

    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda client, uid: Parent())
    token = store.active_uid.set("sandbox-uid")
    return events, token


def sample():
    records = [{
        "id": f"tx-{i:05d}", "type": "receita",
        "status": "pago", "date": "2026-10-03",
        "value_cents": 1, "account_id": "bank",
    } for i in range(20005)]
    records.append({
        "id": "old-card-purchase", "type": "despesa",
        "status": "pago", "date": "2026-08-12",
        "value_cents": 4500, "card_id": "card", "category_id": "food",
    })
    cards = [{"id": "card", "invoice_adjustments": {"2026-08-28": [
        {"id": "credit", "date": "2026-10-26", "purchase_id": "old-card-purchase",
         "credit_cents": 2000}
    ]}}]
    return records, cards


def test_paginated_live_shadow_rebuild_and_second_scan_exact_parity(monkeypatch):
    records, cards = sample()
    metrics, token = fixture(monkeypatch, records)
    try:
        revision = asyncio.run(finance_revision("sandbox-uid"))
        snap = asyncio.run(build_shadow_candidate("sandbox-uid", cards, revision))
        assert snap["source_count"] == 20006
        assert snap["months"]["2026-10"]["income_cents"] == 20005
        assert snap["months"]["2026-10"]["expense_cents"] == -2000
        report = asyncio.run(
            check_shadow_candidate("sandbox-uid", cards, revision, snap)
        )
        assert report["match"], report
        assert report["source_count"] == 20006
        assert report["production_eligible"] is False
        assert metrics["pages"] > 132
    finally:
        store.active_uid.reset(token)


def test_shadow_diff_is_detected_and_originals_are_never_overwritten(monkeypatch):
    records, cards = sample()
    _, token = fixture(monkeypatch, records)
    try:
        snap = asyncio.run(build_shadow_candidate("sandbox-uid", cards, 15))
        drift = deepcopy(snap)
        drift["months"]["2026-10"]["income_cents"] += 1
        drift["checksum"] = snapshot_checksum(drift)
        report = asyncio.run(check_shadow_candidate(
            "sandbox-uid", cards, 15, drift
        ))
        assert report["match"] is False
        assert report["diffs"]["2026-10"]["shadow"]["income_cents"] == 20006
        assert records[0]["value_cents"] == 4500
    finally:
        store.active_uid.reset(token)


def test_concurrent_revision_change_blocks_build(monkeypatch):
    records, cards = sample()
    events, token = fixture(monkeypatch, records)
    try:
        events["change_at"] = 2
        with pytest.raises(HTTPException) as exc:
            asyncio.run(build_shadow_candidate("sandbox-uid", cards, 15))
        assert exc.value.status_code == 409
    finally:
        store.active_uid.reset(token)


def test_cross_uid_rejected_before_scanning(monkeypatch):
    records, cards = sample()
    events, token = fixture(monkeypatch, records)
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(build_shadow_candidate("another-uid", cards, 15))
        assert exc.value.status_code == 403
        assert events["pages"] == 0
    finally:
        store.active_uid.reset(token)
