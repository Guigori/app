"""ARQ-02/FIN-03/13: paged projection history keeps financial prerequisites.

No Firestore credentials or real user documents. Verify the implementation
never discards a matching fixed bill, a historical installment or an old
purchase referenced by a current refund.
"""
import asyncio
from bisect import bisect_right
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib import db as store
from finnos.lib.account_balances import PAGE_SIZE, finance_revision
from finnos.lib.competency import monthly_competency
from finnos.lib.projection_reads import (
    projection_relevant, read_projection_history, referenced_purchase_ids,
)
from finnos.lib.recurrence import monthly_projection_sources
from finnos.lib.subscription_projection import planned_subscriptions


def row(identifier, *, day="2026-03-05", amount=1000, **extra):
    obj = {
        "id": identifier, "date": day, "value_cents": amount,
        "name": identifier, "account_id": "bank", "card_id": None,
        "type": "despesa", "status": "pago", "fixed": False,
        "installment": False,
    }
    obj.update(extra)
    return obj


class Snapshot:
    def __init__(self, obj, identifier=None):
        self.id = identifier if identifier is not None else obj["id"]
        self._obj = obj
        self.exists = obj is not None

    def to_dict(self):
        return dict(self._obj) if self._obj is not None else None


class PagedQuery:
    def __init__(self, records, metrics):
        self.records = records
        self.metrics = metrics
        self.ids = [x["id"] for x in records]
        self.cursor = None
        self.page_size = 0

    def start_after(self, snap):
        self.cursor = snap.id
        return self

    def limit(self, n):
        assert n == PAGE_SIZE
        self.page_size = n
        self.metrics["limits"].append(n)
        return self

    def stream(self, timeout=None):
        assert timeout == 15
        self.metrics["reads"] += 1
        if self.metrics["change_at"] == self.metrics["reads"]:
            self.metrics["revision"] += 1
        ix = bisect_right(self.ids, self.cursor) if self.cursor else 0
        return iter(Snapshot(x) for x in self.records[ix:ix + self.page_size])


def configure(monkeypatch, records):
    records.sort(key=lambda x: x["id"])
    metrics = {"limits": [], "reads": 0, "revision": 9, "change_at": None}

    class Collection:
        def order_by(self, key):
            assert key == "__name__"
            return PagedQuery(records, metrics)

    class Parent:
        def collection(self, name):
            if name == "transactions":
                return Collection()
            assert name == "_meta"
            return type("Meta", (), {"document": lambda self, key: type(
                "Ref", (), {"get": lambda self: Snapshot(
                    {"revision": metrics["revision"]}, key
                )})()})()

    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Parent())
    token = store.active_uid.set("uid-test")
    return metrics, token


def test_selective_projection_preserves_legacy_fixed_and_credit_originals(monkeypatch):
    records = [row(f"unrelated-{i:05d}") for i in range(20007)]
    records += [
        row("old-purchase", day="2026-02-25", amount=50000,
            card_id="card", category_id="shopping"),
        row("monthly-series", day="2026-01-31", amount=4990,
            fixed=1, name="Netflix", category_id="streaming"),
        row("this-month", day="2026-10-29", amount=4990,
            name="Netflix", category_id="streaming", status="agendado"),
        row("old-installment", day="2026-07-12", amount=30000,
            installment=True, total_installments=4, current_installment=1,
            card_id="card", category_id="shopping"),
        row("salary", day="2026-10-05", amount=100000,
            type="receita"),
    ]
    cards = [{"id": "card", "invoice_adjustments": {
        "2026-02-28": [{
            "id": "credit", "purchase_id": "old-purchase",
            "date": "2026-10-26", "credit_cents": 2500,
        }]
    }}]
    metrics, token = configure(monkeypatch, records)
    try:
        revision = asyncio.run(finance_revision("uid-test"))
        selected = asyncio.run(read_projection_history("uid-test", ["2026-10"], cards, revision))
        assert {x["id"] for x in selected} == {
            "old-purchase", "old-installment", "monthly-series", "this-month", "salary",
        }
        # The explicit pending occurrence suppresses a duplicate recurring charge.
        assert monthly_projection_sources(selected, "2026-10") == []
        expected = monthly_competency(
            [dict(store.decode(x), id=x["id"]) for x in records],
            cards, "2026-10",
        )
        assert monthly_competency(selected, cards, "2026-10") == expected
        assert metrics["reads"] > 66
        assert set(metrics["limits"]) == {PAGE_SIZE}
    finally:
        store.active_uid.reset(token)


def test_projection_keeps_old_matching_subscription_fixed_bill():
    matching = row("match", day="2025-01-10", amount=4990,
                   name="Netflix", fixed=True, category_id="streaming")
    subscription = {
        "id": "netflix", "name": "Netflix", "value": Decimal("49.90"),
        "account_id": "bank", "card_id": None, "category_id": "streaming",
        "recurrence": "mensal", "next_charge": "2026-10-30", "active": True,
    }
    assert projection_relevant(matching, frozenset({"2026-10"}), frozenset())
    decoded = dict(store.decode(matching))
    assert planned_subscriptions([subscription], [decoded], "2026-10", "2026-10-01") == []


def test_revision_change_fails_closed(monkeypatch):
    records = [row(f"x-{i:04d}") for i in range(PAGE_SIZE + 1)]
    metrics, token = configure(monkeypatch, records)
    try:
        revision = asyncio.run(finance_revision("uid-test"))
        metrics["change_at"] = 2
        with pytest.raises(HTTPException) as exc:
            asyncio.run(read_projection_history("uid-test", ["2026-10"], [], revision))
        assert exc.value.status_code == 409
    finally:
        store.active_uid.reset(token)


def test_uid_boundary_and_original_ids(monkeypatch):
    assert referenced_purchase_ids([
        {"invoice_refunds": {"2026-10-20": [
            {"purchase_id": "old"}, {"purchase_id": None}
        ]}}
    ]) == frozenset({"old"})
    metrics, token = configure(monkeypatch, [])
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(read_projection_history("other", ["2026-10"], [], 9))
        assert exc.value.status_code == 403
        assert metrics["reads"] == 0
    finally:
        store.active_uid.reset(token)
