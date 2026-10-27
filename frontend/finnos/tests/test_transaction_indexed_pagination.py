"""ARQ-02/03: bounded per-user Firestore reads by indexed month and cursor.

Synthetic Firestore only. Each query requests at most limit+1 documents and
never traverses the whole 20k-transaction collection.
"""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.lib import db as store
from finnos.routers import transactions


def transaction(number: int, uid: str = "owner", day: str = "2026-10-20"):
    return {
        "id": f"tx-{number:04d}",
        "name": f"Lançamento {number}",
        "date": day, "type": "despesa", "status": "pago",
        "value_cents": 1000 + number, "account_id": "bank",
        "category_id": None, "card_id": None,
        "created_at": datetime(2026, 10, 20, tzinfo=timezone.utc),
    }


class Snapshot:
    def __init__(self, row):
        self.id = row["id"]
        self.row = row
        self.exists = True
    def to_dict(self):
        return dict(self.row)


class IndexedQuery:
    def __init__(self, rows, metrics):
        self.rows, self.metrics = rows, metrics
        self.conditions = []
        self.cursor = None
        self.count = 0
        self.direction = "desc"

    def where(self, field, op, value):
        assert field == "date" and op in (">=", "<=")
        self.conditions.append((op, value))
        return self

    def order_by(self, field, direction=None):
        assert field == "date"
        self.direction = "asc" if str(direction).lower().endswith("ascending") else "desc"
        return self

    def start_after(self, snapshot):
        self.cursor = (snapshot.to_dict()["date"], snapshot.id)
        return self

    def limit(self, count):
        assert 1 <= count <= 400
        self.count = count
        self.metrics["limits"].append(count)
        return self

    def stream(self, timeout=None):
        assert timeout == 15
        results = self.rows
        for op, value in self.conditions:
            results = [r for r in results if (r["date"] >= value if op == ">=" else r["date"] <= value)]
        results = sorted(results, key=lambda r: (r["date"], r["id"]), reverse=self.direction == "desc")
        if self.cursor:
            old_date, old_id = self.cursor
            old_key = (old_date, old_id)
            results = [r for r in results if
                       ((r["date"], r["id"]) < old_key if self.direction == "desc"
                        else (r["date"], r["id"]) > old_key)]
        yield from (Snapshot(row) for row in results[:self.count])


class Collection:
    def __init__(self, rows, metrics):
        self.rows, self.metrics = rows, metrics

    def where(self, field, op, value):
        return IndexedQuery(self.rows, self.metrics).where(field, op, value)

    def document(self, key):
        row = next((row for row in self.rows if row["id"] == key), None)
        return SimpleNamespace(get=lambda: Snapshot(row) if row else SimpleNamespace(exists=False))


def configure(monkeypatch, uid="owner", count=2300):
    groups = {uid: [transaction(i, uid) for i in range(count)], "other": [transaction(9999, "other")]}
    metrics = {"limits": [], "groups": groups}
    monkeypatch.setattr(store, "scoped", lambda query: query["user_id"])
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, owner: SimpleNamespace(
        collection=lambda name: Collection(groups[owner], metrics)
    ))

    class AsyncQuery:
        async def to_list(self, maximum):
            return []
    class AsyncCollection:
        def find(self, query):
            assert query["user_id"] in groups
            return AsyncQuery()

    monkeypatch.setattr(transactions, "db", SimpleNamespace(
        accounts=AsyncCollection(), categories=AsyncCollection(), cards=AsyncCollection()
    ))
    return metrics


def page(month="2026-10", limit=50, cursor=None, uid="owner", **filters):
    args = dict(
        month=month, limit=limit, cursor=cursor, user={"id": uid},
        start_date=None, end_date=None, type=None, status=None,
        category_id=None, account_id=None, search=None, sort_dir="desc",
    )
    args.update(filters)
    return asyncio.run(transactions.list_transactions_page(**args))


def test_2300_transactions_load_in_ordered_bounded_pages(monkeypatch):
    metrics = configure(monkeypatch)
    first = page(limit=100)
    assert len(first["items"]) == 100
    assert first["next_cursor"]
    assert first["items"][0].id == "tx-2299"
    second = page(limit=100, cursor=first["next_cursor"])
    assert len(second["items"]) == 100
    assert not set(item.id for item in first["items"]) & set(item.id for item in second["items"])
    assert metrics["limits"] == [101, 101]


def test_short_last_page_has_no_cursor(monkeypatch):
    metrics = configure(monkeypatch, count=3)
    result = page(limit=10)
    assert len(result["items"]) == 3
    assert result["next_cursor"] is None
    assert metrics["limits"] == [11]


def test_cursor_outside_month_or_missing_returns_422(monkeypatch):
    configure(monkeypatch, count=4)
    with pytest.raises(HTTPException) as missing:
        page(cursor="fake-id")
    assert missing.value.status_code == 422
    with pytest.raises(HTTPException) as wrong_date:
        page(month="2026-11", cursor="tx-0000")
    assert wrong_date.value.status_code == 422


def test_uid_isolation_no_cross_user_transactions(monkeypatch):
    configure(monkeypatch, uid="owner", count=3)
    result = page(uid="other")
    assert [item.id for item in result["items"]] == ["tx-9999"]



def test_sparse_search_advances_cursor_across_empty_pages(monkeypatch):
    metrics = configure(monkeypatch, count=2300)
    # All records have "Lançamento" prefix: find only the oldest one.
    # Bounded scans must not misreport "nothing found" as exhausted.
    cursor = None
    collected = []
    for _ in range(30):
        result = page(limit=25, cursor=cursor, search="Lançamento 0")
        collected.extend(item.id for item in result["items"])
        if result["next_cursor"] is None:
            break
        assert result["next_cursor"] != cursor
        cursor = result["next_cursor"]
    assert len(collected) == 1000
    assert len(set(collected)) == len(collected)
    assert all(1 <= n <= 400 for n in metrics["limits"])


def test_filtering_type_status_category_account_and_date(monkeypatch):
    metrics = configure(monkeypatch, count=150)
    groups = metrics["groups"]
    records = groups["owner"]
    for idx, row in enumerate(records):
        row["date"] = "2026-10-21" if idx % 2 else "2026-10-20"
        row["type"] = "receita" if idx % 3 == 0 else "despesa"
        row["status"] = "pendente" if idx % 5 == 0 else "pago"
        row["category_id"] = "food" if idx % 4 == 0 else "other"
        row["to_account_id"] = "other-account" if idx % 7 == 0 else None
    results = []
    cursor = None
    while True:
        answer = page(month=None, start_date="2026-10-20", end_date="2026-10-21",
                      type="receita", status="pago", category_id="food",
                      account_id="other-account", sort_dir="asc", limit=3,
                      cursor=cursor)
        results.extend(answer["items"])
        if not answer["next_cursor"]:
            break
        cursor = answer["next_cursor"]
    expected = [
        r["id"] for i,r in enumerate(records) if i % 3 == 0
        and i % 5 != 0 and i % 4 == 0 and i % 7 == 0
    ]
    assert sorted(tx.id for tx in results) == sorted(expected)
    assert all(n <= 400 for n in metrics["limits"])


def test_invalid_date_range_rejected_before_firestore(monkeypatch):
    configure(monkeypatch, count=2)
    for args in (
        {"month": None},
        {"month": None, "start_date": "2026-10-30", "end_date": "2026-10-01"},
        {"month": None, "start_date": "2026-02-30", "end_date": "2026-10-31"},
        {"month": None, "start_date": "2025-01-01", "end_date": "2026-10-31"},
    ):
        with pytest.raises(HTTPException) as err:
            page(**args)
        assert err.value.status_code == 422
