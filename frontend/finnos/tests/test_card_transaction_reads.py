"""ARQ-02: per-card read-only invoice pagination, isolated synthetic Firestore."""
import asyncio
from bisect import bisect_right
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.lib import db as store
from finnos.lib.account_balances import PAGE_SIZE, finance_revision
from finnos.lib.card_transaction_reads import read_card_purchases
from finnos.lib.invoices import default_invoice_cycle, invoice_state


class Snap:
    def __init__(self, row, identifier=None):
        self.row = row
        self.id = identifier or row["id"]
        self.exists = row is not None

    def to_dict(self):
        return dict(self.row) if self.row is not None else None


class Query:
    def __init__(self, rows, metrics):
        self.rows = rows
        self.metrics = metrics
        self.cursor = None
        self.count = None
        self.card = None

    def where(self, field, operator, value):
        assert (field, operator) == ("card_id", "==")
        self.card = value
        return self

    def order_by(self, key):
        assert key == "__name__"
        return self

    def start_after(self, snapshot):
        self.cursor = snapshot.id
        return self

    def limit(self, count):
        assert count == PAGE_SIZE
        self.count = count
        self.metrics["limits"].append(count)
        return self

    def stream(self, timeout=None):
        assert timeout == 15
        self.metrics["pages"] += 1
        if self.metrics.get("change_at") == self.metrics["pages"]:
            self.metrics["revision"] += 1
        rows = self.metrics["by_card"][self.card]
        ids = self.metrics["ids"][self.card]
        start = bisect_right(ids, self.cursor) if self.cursor else 0
        return (Snap(row) for row in rows[start:start + self.count])


def configure(monkeypatch, rows):
    groups = {}
    for row in rows:
        groups.setdefault(row["card_id"], []).append(row)
    for values in groups.values():
        values.sort(key=lambda row: row["id"])
    metrics = {
        "by_card": groups,
        "ids": {k: [x["id"] for x in v] for k, v in groups.items()},
        "revision": 5, "limits": [], "pages": 0, "change_at": None,
    }

    class Parent:
        def collection(self, kind):
            if kind == "transactions":
                return SimpleNamespace(where=lambda *args: Query(rows, metrics).where(*args))
            assert kind == "_meta"
            return SimpleNamespace(document=lambda key: SimpleNamespace(
                get=lambda: Snap({"revision": metrics["revision"]}, key)
            ))

    monkeypatch.setattr(store, "root", lambda client, uid: Parent())
    monkeypatch.setattr(store, "client", lambda: object())
    token = store.active_uid.set("only-owner")
    return metrics, token


def purchase(index, card="card-one", value=1):
    return {
        "id": f"tx-{index:05d}-{card}", "name": "Compra sintética",
        "type": "despesa", "status": "pago", "date": "2026-10-20",
        "value_cents": value, "card_id": card, "account_id": "bank",
        "installment": False,
    }


def card():
    return {"id": "card-one", "name": "Cartão sintético",
            "closing_day": 29, "due_day": 7, "invoice_cycles": {}}


def test_invoice_old_purchases_not_cut_at_20000_and_other_cards_excluded(monkeypatch):
    rows = [purchase(i) for i in range(20005)]
    rows.extend([purchase(0, "other-card", 50000), purchase(1, "other-card", 100)])
    metrics, token = configure(monkeypatch, rows)
    try:
        rev = asyncio.run(finance_revision("only-owner"))
        docs = asyncio.run(read_card_purchases("only-owner", "card-one", rev))
        assert len(docs) == 20005
        assert all(row["card_id"] == "card-one" for row in docs)
        state = invoice_state(card(), docs, "2026-10-29")
        assert state["total_cents"] == 20005
        assert default_invoice_cycle(card(), docs, date(2026, 10, 27)) == "2026-10-29"
        assert set(metrics["limits"]) == {PAGE_SIZE}
        assert metrics["pages"] > 66
    finally:
        store.active_uid.reset(token)


def test_concurrent_card_edit_does_not_publish_mixed_invoice(monkeypatch):
    metrics, token = configure(monkeypatch, [purchase(i) for i in range(PAGE_SIZE + 1)])
    try:
        rev = asyncio.run(finance_revision("only-owner"))
        metrics["change_at"] = 2
        with pytest.raises(HTTPException) as err:
            asyncio.run(read_card_purchases("only-owner", "card-one", rev))
        assert err.value.status_code == 409
    finally:
        store.active_uid.reset(token)


def test_cross_uid_card_history_is_denied(monkeypatch):
    metrics, token = configure(monkeypatch, [purchase(0)])
    try:
        with pytest.raises(HTTPException) as err:
            asyncio.run(read_card_purchases("other-user", "card-one", 5))
        assert err.value.status_code == 403
        assert metrics["pages"] == 0
    finally:
        store.active_uid.reset(token)
