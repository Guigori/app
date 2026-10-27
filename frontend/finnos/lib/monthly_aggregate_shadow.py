"""ARQ-02/04: staged, incrementally maintainable monthly financial materialization.

This is deliberately NOT connected to production reads or financial write
paths. Historical Firestore users have no certified baseline, and credit/card
writes use several paths. A shadow projection must be reconciled at the same
revision with the existing monthly_competency contract before any cutover.

All deltas are exact integer cents. Public code can simulate create/update/
delete and card-ledger changes without touching real financial records.
"""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
import hashlib
import json

from fastapi import HTTPException

from finnos.lib.competency import credit_events, monthly_competency
from finnos.lib.money import D, cents, remaining_installment_indices
from finnos.lib.stats import add_months, month_portion

SCHEMA_VERSION = 1
UNCATEGORIZED = ""
_MISSING = object()


@dataclass
class MonthTotals:
    income_cents: int = 0
    expense_cents: int = 0
    count: int = 0
    categories_cents: dict[str, int] = field(default_factory=dict)

    def change(self, income: int, expense: int, count: int,
               category=_MISSING) -> None:
        self.income_cents += income
        self.expense_cents += expense
        self.count += count
        if category is not _MISSING and expense:
            key = category or UNCATEGORIZED
            self.categories_cents[key] = self.categories_cents.get(key, 0) + expense
            if self.categories_cents[key] == 0:
                del self.categories_cents[key]

    def row(self) -> dict:
        return {
            "income_cents": self.income_cents,
            "expense_cents": self.expense_cents,
            "count": self.count,
            "categories_cents": dict(sorted(self.categories_cents.items())),
        }


def transaction_months(tx: dict) -> list[str]:
    """Same competency months as month_portion; no forward recurrence invented."""
    month = str(tx["date"])[:7]
    if not tx.get("installment"):
        return [month]
    installments = remaining_installment_indices(tx)
    if len(installments) > 600:
        raise ValueError("Parcelamento exige conciliação manual.")
    return [add_months(month, offset) for offset in range(len(installments))]


def _transaction_changes(tx: dict) -> dict[str, MonthTotals]:
    out = {}
    for month in transaction_months(tx):
        value = month_portion(tx, month)
        if value is None:
            continue
        kind = tx["type"]
        total = cents(value)
        row = out.setdefault(month, MonthTotals())
        row.change(
            total if kind == "receita" else 0,
            total if kind == "despesa" else 0,
            1,
            tx.get("category_id") if kind == "despesa" else None,
        )
    return out


def _credits(card: dict | None, originals: dict[str, dict]) -> dict[str, MonthTotals]:
    if not card:
        return {}
    referenced = {
        event["purchase_id"]
        for ledger in ("invoice_adjustments", "invoice_refunds")
        for entries in (card.get(ledger) or {}).values()
        for event in entries
    }
    missing = referenced - originals.keys()
    if missing:
        raise ValueError("Crédito sem compra original; agregado não confiável.")
    out = {}
    for event in credit_events([card], list(originals.values())):
        key = str(event["date"])[:7]
        bucket = out.setdefault(key, MonthTotals())
        bucket.change(
            0, -int(event["cents"]), 0, event.get("category_id"),
        )
    return out


class IncrementalMonthlyLedger:
    """Pure deltas; never mutate the original transactions or card ledgers."""

    def __init__(self):
        self.months: dict[str, MonthTotals] = {}

    def _apply(self, values: dict[str, MonthTotals], sign: int) -> None:
        for month, part in values.items():
            bucket = self.months.setdefault(month, MonthTotals())
            bucket.change(sign * part.income_cents, sign * part.expense_cents,
                          sign * part.count)
            for category, amount in part.categories_cents.items():
                bucket.categories_cents[category] = (
                    bucket.categories_cents.get(category, 0) + sign * amount
                )
                if bucket.categories_cents[category] == 0:
                    del bucket.categories_cents[category]
            if bucket.row() == MonthTotals().row():
                del self.months[month]

    def transaction_changed(
        self, before: dict | None, after: dict | None,
    ) -> None:
        if before:
            self._apply(_transaction_changes(before), -1)
        if after:
            self._apply(_transaction_changes(after), 1)

    def card_credits_changed(
        self, before: dict | None, after: dict | None,
        originals: dict[str, dict],
    ) -> None:
        if before:
            self._apply(_credits(before, originals), -1)
        if after:
            self._apply(_credits(after, originals), 1)

    @classmethod
    def from_history(cls, transactions: list[dict], cards: list[dict]):
        engine = cls()
        originals = {tx["id"]: tx for tx in transactions}
        for tx in transactions:
            engine.transaction_changed(None, tx)
        for card in cards:
            engine.card_credits_changed(None, card, originals)
        return engine

    def snapshot(self, revision: int, *, source_count: int | None = None) -> dict:
        if type(revision) is not int or revision < 0:
            raise ValueError("Revisão financeira inválida.")
        if source_count is not None and (type(source_count) is not int or source_count < 0):
            raise ValueError("Contagem de histórico inválida.")
        rows = {month: item.row()
                for month, item in sorted(self.months.items())}
        result = {
            "schema_version": SCHEMA_VERSION,
            "finance_revision": revision,
            "status": "shadow_only",
            "months": rows,
        }
        if source_count is not None:
            result["source_count"] = source_count
        result["checksum"] = snapshot_checksum(result)
        return result


def snapshot_checksum(snapshot: dict) -> str:
    payload = {
        "schema_version": snapshot["schema_version"],
        "finance_revision": snapshot["finance_revision"],
        "months": snapshot["months"],
    }
    # Include source count when present; it is part of historical coverage.
    if "source_count" in snapshot:
        payload["source_count"] = snapshot["source_count"]
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def reconcile_months(
    snapshot: dict, transactions: list[dict], cards: list[dict],
    revision: int, months: list[str] | None = None,
) -> dict:
    """Independently compare the snapshot to the canonical month engine.

    Returns a diff report; never authorizes production use, even if matching.
    Caller must acquire and verify the finance revision around *all* reads.
    """
    if (snapshot.get("schema_version") != SCHEMA_VERSION
            or snapshot.get("finance_revision") != revision
            or snapshot.get("status") != "shadow_only"
            or snapshot.get("checksum") != snapshot_checksum(snapshot)):
        return {"match": False, "reason": "stale_or_unknown_schema", "diffs": {}}

    expected = IncrementalMonthlyLedger.from_history(transactions, cards)
    # Include the months in both ledgers, or explicit requested months.
    checked = (sorted(set(snapshot["months"]) | set(expected.months))
               if months is None else sorted(set(months)))
    diffs = {}
    for month in checked:
        actual = monthly_competency(transactions, cards, month)
        count = sum(month_portion(tx, month) is not None for tx in transactions)
        canonical = {
            "income_cents": cents(actual["income"]),
            "expense_cents": cents(actual["expense"]),
            "count": count,
            "categories_cents": {
                (key or UNCATEGORIZED): cents(value)
                for key, value in actual["by_category"].items() if cents(value)
            },
        }
        observed = snapshot["months"].get(month, MonthTotals().row())
        if canonical != observed:
            diffs[month] = {"expected": canonical, "candidate": observed}
    return {
        "match": not diffs,
        "reason": "cent_parity" if not diffs else "mismatch",
        "checked_months": checked,
        "diffs": diffs,
        "finance_revision": revision,
        "production_eligible": False,
    }


def stage_shadow_snapshot(transaction, parent, snapshot: dict, expected_revision: int,
                          *, approval: bool = False,
                          verification_report: dict | None = None) -> None:
    """Opt-in shadow writer: unreachable from live routers.

    Revision guard uses the same transaction as shadow writes. The candidate
    is always marked shadow_only, never the current balance source.
    """
    if not approval:
        raise HTTPException(403, "Persistência de agregados exige autorização explícita.")
    if (snapshot.get("finance_revision") != expected_revision
            or snapshot.get("status") != "shadow_only"
            or snapshot.get("schema_version") != SCHEMA_VERSION
            or snapshot.get("checksum") != snapshot_checksum(snapshot)):
        raise HTTPException(409, "Agregado incompatível com a revisão financeira.")
    # No shadow writes unless a separate pass against the canonical finance
    # compiler independently verified the *same* checksum, revision and all
    # candidate months. Even a manual opt-in cannot bypass reconciliation.
    report = verification_report or {}
    if (report.get("match") is not True
            or report.get("finance_revision") != expected_revision
            or report.get("candidate_checksum") != snapshot["checksum"]
            or report.get("production_eligible") is not False
            or report.get("diffs") != {}
            or sorted(report.get("checked_months") or []) != sorted(snapshot["months"])
            or report.get("source_count") != snapshot.get("source_count")):
        raise HTTPException(409, "Agregado sem reconciliação completa do histórico.")
    rev_doc = parent.collection("_meta").document("finance").get(transaction=transaction)
    current = (rev_doc.to_dict() or {}).get("revision", 0) if rev_doc.exists else 0
    if current != expected_revision:
        raise HTTPException(409, "Histórico alterado antes da gravação do agregado.")
    if len(snapshot["months"]) > 200:
        raise HTTPException(413, "Agregados devem ser gravados em lotes menores.")
    for month, row in snapshot["months"].items():
        if not isinstance(month, str) or len(month) != 7:
            raise HTTPException(422, "Mês de agregado inválido.")
        transaction.set(
            parent.collection("_finance_month_shadows_v1").document(month),
            {"schema_version": SCHEMA_VERSION, "finance_revision": expected_revision,
             "status": "shadow_only", **row},
        )
