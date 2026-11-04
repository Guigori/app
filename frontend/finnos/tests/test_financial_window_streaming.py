"""ARQ-02/04: one bounded, revision-safe scan for Dashboard and Trends.

Synthetic snapshots only; compare money with the legacy pure competency
contract, including installments and credits from older purchases.
"""
import asyncio
import json
from bisect import bisect_right
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.lib import db as store
from finnos.lib.account_balances import PAGE_SIZE, finance_revision
from finnos.lib.competency import monthly_competency
from finnos.lib.financial_summaries import FinancialWindow, stream_financial_window
from finnos.lib.money import cents


FIXTURE = json.loads(
    (Path(__file__).resolve().parents[2] / "fixtures" / "finance-ledger-parity.json")
    .read_text(encoding="utf-8")
)


def fixture_cards():
    card = {"id": "card", "invoice_adjustments": {}, "invoice_refunds": {}}
    for event in FIXTURE["credit_events"]:
        ledger_key = ("invoice_refunds" if event["kind"] == "bank_refund"
                      else "invoice_adjustments")
        value_key = ("refund_cents" if ledger_key == "invoice_refunds"
                     else "credit_cents")
        card[ledger_key].setdefault(event["cycle"], []).append({
            "id": event["id"], "date": event["date"],
            "purchase_id": event["purchase_id"], value_key: cents(event["value"]),
        })
    return [card]


def test_pure_window_matches_monthly_competency_and_cash_parity():
    cards = fixture_cards()
    months = ["2026-09", "2026-10", "2026-11"]
    statement = FinancialWindow(months, cards, accounts=FIXTURE["accounts"],
                                today=FIXTURE["today"], recent_month="2026-10")
    for tx in FIXTURE["transactions"]:
        statement.add(tx)
    statement.finalize()
    for month in months:
        expected = monthly_competency(FIXTURE["transactions"], cards, month)
        got = statement.monthly(month)
        assert got["income"] == expected["income"]
        assert got["expense"] == expected["expense"]
        assert got["by_category"] == expected["by_category"]
        assert got["net"] == expected["net"]
    assert statement.accounts.total_balance == Decimal("2800.00")
    assert [row["id"] for row in statement.recent] == [
        "refund", "transfer", "invoice-payment", "rent", "salary",
    ]


def test_installments_and_legacy_refunds_are_included_without_date_cutoff():
    cards = fixture_cards()
    txs = FIXTURE["transactions"] + [{
        "id": "old-purchase", "type": "despesa", "status": "pago",
        "date": "2026-07-20", "value": "100.00", "installment": True,
        "total_installments": 4, "current_installment": 1,
        "card_id": "card", "account_id": "bank", "category_id": "shopping",
    }]
    statement = FinancialWindow(["2026-10"], cards)
    for tx in txs:
        statement.add(tx)
    statement.finalize()
    expected = monthly_competency(txs, cards, "2026-10")
    assert statement.monthly("2026-10")["expense"] == expected["expense"]
    assert statement.monthly("2026-10")["expense"] == Decimal("875.00")


class Snapshot:
    def __init__(self, row, identifier=None):
        self.id = identifier if identifier is not None else row["id"]
        self.row = row
        self.exists = row is not None

    def to_dict(self):
        return dict(self.row) if self.row is not None else None


class Query:
    def __init__(self, rows, ids, metrics):
        self.rows, self.ids, self.metrics = rows, ids, metrics
        self.cursor = None
        self.count = None

    def start_after(self, snapshot):
        self.cursor = snapshot.id
        return self

    def limit(self, number):
        assert 1 <= number <= PAGE_SIZE
        self.count = number
        self.metrics["limits"].append(number)
        return self

    def stream(self, timeout=None):
        assert timeout == 15
        self.metrics["pages"] += 1
        if self.metrics.get("change_at") == self.metrics["pages"]:
            self.metrics["revision"] += 1
        start = bisect_right(self.ids, self.cursor) if self.cursor else 0
        return iter(Snapshot(row) for row in self.rows[start:start + self.count])


def configure(monkeypatch, rows):
    rows = sorted(rows, key=lambda row: row["id"])
    ids = [row["id"] for row in rows]
    metrics = {"revision": 17, "limits": [], "pages": 0, "change_at": None}

    class Parent:
        def collection(self, kind):
            if kind == "transactions":
                return SimpleNamespace(order_by=lambda field: (
                    Query(rows, ids, metrics) if field == "__name__" else None
                ))
            assert kind == "_meta"
            return SimpleNamespace(document=lambda key: SimpleNamespace(
                get=lambda: Snapshot({"revision": metrics["revision"]}, key)
            ))

    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Parent())
    token = store.active_uid.set("synthetic-uid")
    return metrics, token


def test_20000_plus_documents_are_folded_and_recent_is_bounded(monkeypatch):
    rows = [{
        "id": f"tx-{i:05d}", "type": "receita", "status": "pago",
        "date": "2026-10-01", "value_cents": 1, "account_id": "bank",
    } for i in range(20007)]
    rows.append({
        "id": "a-refund", "type": "receita", "status": "pago",
        "date": "2026-10-22", "value_cents": 2000, "account_id": "bank",
        "invoice_refund": True,
    })
    metrics, token = configure(monkeypatch, rows)
    try:
        revision = asyncio.run(finance_revision("synthetic-uid"))
        result = asyncio.run(stream_financial_window(
            "synthetic-uid", ["2026-10"], [], revision,
            accounts=[{"id": "bank", "initial_balance": "-5.50"}],
            today="2026-10-27", recent_month="2026-10",
        ))
        assert result.monthly("2026-10")["income"] == Decimal("200.07")
        assert result.monthly("2026-10")["expense"] == Decimal("0")
        assert result.accounts.total_balance == Decimal("214.57")
        assert len(result.recent) == 6
        assert result.recent[0]["id"] == "a-refund"
        assert metrics["pages"] > 66
        assert set(metrics["limits"]) == {PAGE_SIZE}
    finally:
        store.active_uid.reset(token)


def test_finance_revision_changed_mid_scan_blocks_partial_statement(monkeypatch):
    rows = [{
        "id": f"tx-{i:05d}", "type": "despesa", "status": "pago",
        "date": "2026-10-01", "value_cents": 1, "account_id": "bank",
    } for i in range(PAGE_SIZE + 3)]
    metrics, token = configure(monkeypatch, rows)
    try:
        revision = asyncio.run(finance_revision("synthetic-uid"))
        metrics["change_at"] = 2
        with pytest.raises(HTTPException) as exc:
            asyncio.run(stream_financial_window(
                "synthetic-uid", ["2026-10"], [], revision,
            ))
        assert exc.value.status_code == 409
    finally:
        store.active_uid.reset(token)


def test_uid_scope_rejects_other_user_before_query(monkeypatch):
    metrics, token = configure(monkeypatch, [])
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(stream_financial_window(
                "other-user", ["2026-10"], [], 17,
            ))
        assert exc.value.status_code == 403
        assert metrics["pages"] == 0
    finally:
        store.active_uid.reset(token)


def test_recent_ties_are_sorted_by_creation_time():
    day = "2026-10-25"
    statement = FinancialWindow(["2026-10"], [], recent_month="2026-10")
    for idx in range(9):
        statement.add({
            "id": f"tx-{idx}", "date": day, "status": "pendente",
            "type": "receita", "value": 10, "account_id": "bank",
            "created_at": datetime(2026, 10, 25, idx, tzinfo=timezone.utc),
        })
    statement.finalize()
    assert [row["id"] for row in statement.recent] == [
        "tx-8", "tx-7", "tx-6", "tx-5", "tx-4", "tx-3",
    ]
