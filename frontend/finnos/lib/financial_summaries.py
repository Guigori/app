"""FIN-07/08 and ARQ-02: bounded, read-only financial window aggregation.

Uses the same month_portion, credit_events, and AccountLedger contracts as
legacy full-array calculations. Each Firestore document is decoded once, then
folded into requested months; we never expose a truncated subtotal.

This removes the fixed 20k-document failure and duplicate Dashboard reads,
but does NOT yet reduce the number of historical Firestore document reads.
Incremental materialized aggregates need separate write-path/e2e validation.
"""
from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib.account_balances import PAGE_SIZE, AccountLedger, _revision
from finnos.lib.competency import credit_events
from finnos.lib.money import D, cents
from finnos.lib.stats import month_portion


class FinancialWindow:
    def __init__(
        self, months: list[str], cards: list[dict],
        accounts: list[dict] | None = None, today: str | None = None,
        recent_month: str | None = None,
    ):
        self.months = tuple(dict.fromkeys(months))
        self._values = {
            month: {"income": 0, "expense": 0, "by_category": defaultdict(int), "count": 0}
            for month in self.months
        }
        self.cards = cards
        self.accounts = (
            AccountLedger(accounts, today) if accounts is not None and today else None
        )
        self.recent_month = recent_month
        self.recent = []
        # Only the categories of purchases referenced by credits in the
        # requested period need to survive the fold.
        self._original_ids = {
            entry["purchase_id"]
            for card in cards
            for ledger in ("invoice_adjustments", "invoice_refunds")
            for entries in (card.get(ledger) or {}).values()
            for entry in entries
            if entry.get("date", "")[:7] in self._values
            and isinstance(entry.get("purchase_id"), str)
        }
        self._originals = {}
        self._finalized = False

    @staticmethod
    def _recent_key(tx):
        # Legacy .sort([("date",-1),("created_at",-1)]) orders the
        # ISO dates and created_at strings descending. Preserve that tie rule.
        return (tx.get("date") or "", str(tx.get("created_at") or ""))

    def add(self, tx: dict):
        if self._finalized:
            raise RuntimeError("Resumo financeiro já consolidado.")
        if self.accounts is not None:
            self.accounts.add(tx)
        identifier = tx.get("id")
        if identifier in self._original_ids:
            self._originals[identifier] = {
                "id": identifier, "category_id": tx.get("category_id")
            }
        if self.recent_month and tx.get("date", "")[:7] == self.recent_month:
            self.recent.append(tx)
            self.recent.sort(key=self._recent_key, reverse=True)
            if len(self.recent) > 6:
                self.recent.pop()
        for month, bucket in self._values.items():
            amount = month_portion(tx, month)
            if amount is None:
                continue
            bucket["count"] += 1
            value = cents(amount)
            if tx["type"] == "receita":
                bucket["income"] += value
            elif tx["type"] == "despesa":
                bucket["expense"] += value
                bucket["by_category"][tx.get("category_id")] += value

    def finalize(self):
        if self._finalized:
            return self
        for credit in credit_events(self.cards, list(self._originals.values())):
            bucket = self._values.get(credit["date"][:7])
            if bucket is not None:
                bucket["expense"] -= credit["cents"]
                bucket["by_category"][credit["category_id"]] -= credit["cents"]
        self._finalized = True
        self._originals.clear()
        return self

    def monthly(self, month: str) -> dict:
        if not self._finalized:
            raise RuntimeError("Finalize o resumo antes de ler os totais.")
        bucket = self._values[month]
        income, expense = bucket["income"], bucket["expense"]
        return {
            "income": D(income) / 100,
            "expense": D(expense) / 100,
            "net": D(income - expense) / 100,
            "by_category": {k: D(v) / 100 for k, v in bucket["by_category"].items()},
            "count": bucket["count"],
        }


async def stream_financial_window(
    user_id: str, months: list[str], cards: list[dict],
    expected_revision: int, *,
    accounts: list[dict] | None = None,
    today: str | None = None,
    recent_month: str | None = None,
) -> FinancialWindow:
    """UID-scoped, document-ID paged scan protected by a finance revision."""
    store.scoped({"user_id": user_id})

    def read():
        parent = store.root(store.client(), user_id)
        window = FinancialWindow(
            months, cards, accounts=accounts, today=today, recent_month=recent_month,
        )
        collection = parent.collection("transactions")
        previous = None
        previous_id = None
        while True:
            query = collection.order_by("__name__")
            if previous is not None:
                query = query.start_after(previous)
            snapshots = list(query.limit(PAGE_SIZE).stream(timeout=15))
            if len(snapshots) > PAGE_SIZE:
                raise HTTPException(503, "Página financeira inválida.")
            for snapshot in snapshots:
                if previous_id is not None and snapshot.id <= previous_id:
                    raise HTTPException(503, "Ordenação financeira inválida.")
                raw = snapshot.to_dict()
                if not isinstance(raw, dict):
                    raise HTTPException(503, "Lançamento financeiro inválido.")
                tx = dict(store.decode(raw), id=snapshot.id, user_id=user_id)
                window.add(tx)
                previous_id = snapshot.id
            if len(snapshots) < PAGE_SIZE:
                break
            previous = snapshots[-1]
        if _revision(parent) != expected_revision:
            raise HTTPException(
                409, "Histórico alterado durante a consulta; atualize para recalcular."
            )
        return window.finalize()

    return await run_in_threadpool(read)
