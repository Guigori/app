"""ARQ-02/04: deterministic bank-account balances with bounded Firestore reads.

The ledger is pure and uses the same balance_effects as Dashboard and the
local engine. The Firestore reader is UID-scoped, ordered by document ID and
paged; it never returns a truncated financial total. A finance revision read
before the account list and checked after the scan detects concurrent writes.
This is a read-only migration step, not a materialized balance or new write.
"""
from decimal import Decimal

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib.money import D, quantize_brl
from finnos.lib.stats import balance_effects

PAGE_SIZE = 300


class AccountLedger:
    """Incremental, cent-exact account reconciliation without storing tx rows."""

    def __init__(self, accounts: list[dict], today: str):
        self.today = today
        self.balances = {
            a["id"]: D(a.get("initial_balance") or D("0.0")) for a in accounts
        }
        self.income = {a["id"]: D("0.0") for a in accounts}
        self.expense = {a["id"]: D("0.0") for a in accounts}

    def add(self, tx: dict) -> None:
        for account_id, amount in balance_effects(tx, self.today):
            if account_id not in self.balances:
                # Never report a partial total if historical movements refer
                # to an account no longer present in the user's collection.
                raise HTTPException(
                    409, "Movimento financeiro vinculado a conta inexistente; conciliação necessária."
                )
            self.balances[account_id] += amount
            if tx.get("type") == "receita":
                self.income[account_id] += amount
            elif tx.get("type") == "despesa":
                self.expense[account_id] -= amount

    def result(self, account_id: str) -> tuple[Decimal, Decimal, Decimal]:
        return (
            quantize_brl(self.balances[account_id]),
            quantize_brl(max(self.income[account_id], D("0.0"))),
            quantize_brl(max(self.expense[account_id], D("0.0"))),
        )

    @property
    def total_balance(self) -> Decimal:
        return quantize_brl(sum(self.balances.values(), D("0.0")))


def _revision(parent) -> int:
    snapshot = parent.collection("_meta").document("finance").get()
    data = snapshot.to_dict() if snapshot.exists else {}
    revision = (data or {}).get("revision", 0)
    if type(revision) is not int or revision < 0:
        raise HTTPException(503, "Versão do histórico financeiro inválida.")
    return revision


async def finance_revision(user_id: str) -> int:
    """Capture revision *before* reading accounts to cover opening balances."""
    store.scoped({"user_id": user_id})

    def read():
        return _revision(store.root(store.client(), user_id))

    return await run_in_threadpool(read)


async def stream_account_balances(
    user_id: str, accounts: list[dict], today: str, expected_revision: int
) -> AccountLedger:
    """Fold every transaction in bounded pages; never return a partial balance.

    The document-ID index is automatic in Firestore, avoiding an unprovisioned
    composite index. Unlike a date/status filter it includes old records with
    absent optional fields, so legacy movements are not silently dropped.
    Reads remain O(history size); materialized aggregates are a later step.
    """
    store.scoped({"user_id": user_id})

    def read():
        parent = store.root(store.client(), user_id)
        ledger = AccountLedger(accounts, today)
        collection = parent.collection("transactions")
        previous_snapshot = None
        previous_id = None
        while True:
            query = collection.order_by("__name__")
            if previous_snapshot is not None:
                query = query.start_after(previous_snapshot)
            snapshots = list(query.limit(PAGE_SIZE).stream(timeout=15))
            if len(snapshots) > PAGE_SIZE:
                raise HTTPException(503, "Página financeira inválida.")
            for snapshot in snapshots:
                if previous_id is not None and snapshot.id <= previous_id:
                    raise HTTPException(503, "Ordenação do histórico financeiro inválida.")
                raw = snapshot.to_dict()
                if not isinstance(raw, dict):
                    raise HTTPException(503, "Registro financeiro inválido.")
                tx = dict(store.decode(raw), id=snapshot.id, user_id=user_id)
                ledger.add(tx)
                previous_id = snapshot.id
            if len(snapshots) < PAGE_SIZE:
                break
            previous_snapshot = snapshots[-1]
        if _revision(parent) != expected_revision:
            raise HTTPException(
                409, "Histórico alterado durante a conciliação; atualize para recalcular."
            )
        return ledger

    return await run_in_threadpool(read)
