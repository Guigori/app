"""ARQ-02/04: bounded Firestore ledger with exact historical cash totals.

These tests use a synthetic Firestore snapshot model; no real UID, rules or
production documents are accessed.
"""
import asyncio
from bisect import bisect_right
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.lib import db as store
from finnos.lib.account_balances import (
    PAGE_SIZE, AccountLedger, finance_revision, stream_account_balances,
)


class Snapshot:
    def __init__(self, row, identifier=None):
        self.id = identifier if identifier is not None else row["id"]
        self.row = row
        self.exists = row is not None

    def to_dict(self):
        return dict(self.row) if self.row is not None else None


class IndexedQuery:
    def __init__(self, rows, ids, metrics):
        self.rows, self.ids, self.metrics = rows, ids, metrics
        self.cursor = None
        self.page_size = None

    def start_after(self, snapshot):
        self.cursor = snapshot.id
        return self

    def limit(self, number):
        assert 1 <= number <= PAGE_SIZE
        self.page_size = number
        self.metrics["limits"].append(number)
        return self

    def stream(self, timeout=None):
        assert timeout == 15
        start = bisect_right(self.ids, self.cursor) if self.cursor else 0
        self.metrics["pages"] += 1
        if self.metrics.get("after_page"):
            self.metrics["after_page"](self.metrics["pages"])
        return (Snapshot(row) for row in self.rows[start:start + self.page_size])


class TransactionCollection:
    def __init__(self, rows, metrics):
        self.rows = sorted(rows, key=lambda row: row["id"])
        self.ids = [row["id"] for row in self.rows]
        self.metrics = metrics

    def order_by(self, field):
        assert field == "__name__"
        return IndexedQuery(self.rows, self.ids, self.metrics)


class FakeRoot:
    def __init__(self, rows, metrics):
        self.transactions = TransactionCollection(rows, metrics)
        self.metrics = metrics

    def collection(self, name):
        if name == "transactions":
            return self.transactions
        assert name == "_meta"
        return SimpleNamespace(document=lambda identifier: SimpleNamespace(
            get=lambda: Snapshot({"revision": self.metrics["revision"]}, identifier),
        ))


def setup(monkeypatch, rows, revision=7):
    metrics = {"limits": [], "pages": 0, "revision": revision}
    root = FakeRoot(rows, metrics)
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda client, uid: root)
    token = store.active_uid.set("synthetic-uid")
    return metrics, token


def account(identifier, opening=0):
    return {"id": identifier, "initial_balance": Decimal(str(opening))}


def paid(identifier, kind, value, account_id="bank", **kwargs):
    return {
        "id": identifier, "type": kind, "status": "pago",
        "date": "2026-10-25", "value_cents": value,
        "account_id": account_id, "card_id": None, **kwargs,
    }


def test_over_20000_movements_preserve_every_cent_without_materializing_history(monkeypatch):
    rows = [paid(f"tx-{i:05d}", "receita", 1) for i in range(20005)]
    rows += [
        paid("transfer", "transferencia", 5000, to_account_id="wallet"),
        paid("invoice", "despesa", 1200, invoice_payment=True),
        paid("card", "despesa", 99900, card_id="credit"),
        paid("pending", "despesa", 3000, status="pendente"),
        paid("future", "receita", 9000, date="2026-11-01"),
        # A legacy row without optional card_id must still be included.
        {"id": "legacy", "type": "despesa", "status": "pago",
         "date": "2026-10-25", "value_cents": 25, "account_id": "bank"},
    ]
    # Avoid duplicate keyword arguments while building synthetic fixtures.
    metrics, token = setup(monkeypatch, rows)
    try:
        opening = [account("bank", "-500.23"), account("wallet")]
        before = asyncio.run(finance_revision("synthetic-uid"))
        ledger = asyncio.run(stream_account_balances(
            "synthetic-uid", opening, "2026-10-27", before,
        ))
        # 200.05 income - 50 transfer - 12 invoice payment - 0.25 legacy.
        assert ledger.result("bank") == (
            Decimal("-362.43"), Decimal("200.05"), Decimal("12.25"),
        )
        assert ledger.result("wallet") == (
            Decimal("50.00"), Decimal("0.00"), Decimal("0.00"),
        )
        assert ledger.total_balance == Decimal("-312.43")
        assert metrics["pages"] > 66
        assert set(metrics["limits"]) == {PAGE_SIZE}
    finally:
        store.active_uid.reset(token)


def test_concurrent_financial_revision_fails_closed(monkeypatch):
    rows = [paid(f"tx-{i:04d}", "receita", 100) for i in range(PAGE_SIZE + 2)]
    metrics, token = setup(monkeypatch, rows)
    try:
        before = asyncio.run(finance_revision("synthetic-uid"))
        metrics["after_page"] = lambda n: metrics.__setitem__("revision", 8) if n == 2 else None
        with pytest.raises(HTTPException) as error:
            asyncio.run(stream_account_balances(
                "synthetic-uid", [account("bank")], "2026-10-27", before,
            ))
        assert error.value.status_code == 409
        assert "alterado" in error.value.detail
    finally:
        store.active_uid.reset(token)


def test_corrupt_cents_and_orphan_account_do_not_produce_partial_balances(monkeypatch):
    rows = [paid("ok", "receita", 100), paid("bad", "despesa", 10)]
    metrics, token = setup(monkeypatch, rows)
    try:
        before = asyncio.run(finance_revision("synthetic-uid"))
        rows[1]["value_cents"] = "not-an-integer"
        # The mock collection holds references to the same document dictionaries.
        with pytest.raises(HTTPException) as bad:
            asyncio.run(stream_account_balances(
                "synthetic-uid", [account("bank")], "2026-10-27", before,
            ))
        assert bad.value.status_code == 503
        rows[1]["value_cents"] = 10
        rows[1]["account_id"] = "missing"
        with pytest.raises(HTTPException) as orphan:
            asyncio.run(stream_account_balances(
                "synthetic-uid", [account("bank")], "2026-10-27", before,
            ))
        assert orphan.value.status_code == 409
    finally:
        store.active_uid.reset(token)


def test_revision_reader_enforces_uid_scope_before_firestore(monkeypatch):
    metrics, token = setup(monkeypatch, [])
    try:
        with pytest.raises(HTTPException) as error:
            asyncio.run(finance_revision("different-user"))
        assert error.value.status_code == 403
        assert metrics["pages"] == 0
    finally:
        store.active_uid.reset(token)


def test_pure_ledger_excludes_pending_future_and_card_purchases():
    ledger = AccountLedger([account("bank", "-10.00")], "2026-10-27")
    ledger.add({"type": "receita", "status": "pendente", "date": "2026-10-25",
                "value": 100, "account_id": "bank"})
    ledger.add({"type": "receita", "status": "pago", "date": "2026-11-01",
                "value": 100, "account_id": "bank"})
    ledger.add({"type": "despesa", "status": "pago", "date": "2026-10-25",
                "value": 100, "account_id": "bank", "card_id": "card"})
    assert ledger.result("bank") == (
        Decimal("-10.00"), Decimal("0.00"), Decimal("0.00"),
    )
