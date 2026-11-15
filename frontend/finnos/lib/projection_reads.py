"""FIN-03/07/08 and ARQ-02: bounded read-only projection history selection.

Every user's transaction is examined under one finance revision. Only records
that can influence a requested period survive in memory. Preserve *all*
fixed series sources, imported installments, same-month explicit entries and
original card purchases referenced by historical credits. Never silently
drop an old purchase needed to classify a refund.

This is not yet a materialized aggregate and still costs O(history) reads.
"""
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib import tx_pack
from finnos.lib.account_balances import PAGE_SIZE, _revision


def projection_relevant(tx: dict, months: frozenset[str], originals: frozenset[str]) -> bool:
    return (
        bool(tx.get("fixed"))
        or tx.get("installment") is True
        or str(tx.get("date") or "")[:7] in months
        or tx.get("id") in originals
    )


def referenced_purchase_ids(cards: list[dict]) -> frozenset[str]:
    return frozenset(
        event["purchase_id"]
        for card in cards
        for kind in ("invoice_adjustments", "invoice_refunds")
        for entries in (card.get(kind) or {}).values()
        for event in entries
        if isinstance(event.get("purchase_id"), str)
    )


async def read_projection_history(
    user_id: str, months: list[str], cards: list[dict], expected_revision: int,
) -> list[dict]:
    """Paginate entire UID-scoped history with no 20k silent cutoff."""
    store.scoped({"user_id": user_id})
    periods = frozenset(months)
    originals = referenced_purchase_ids(cards)

    def read():
        parent = store.root(store.client(), user_id)
        selected = []
        for tx_id, raw in tx_pack.raw_transactions(parent, expected_revision):
            # Filter cheap date/series flags before decoding monetary fields.
            # Referenced originals must never be lost to this predicate.
            if projection_relevant(dict(raw, id=tx_id), periods, originals):
                selected.append(dict(store.decode(raw), id=tx_id, user_id=user_id))
        if _revision(parent) != expected_revision:
            raise HTTPException(
                409, "Histórico alterado durante a projeção; atualize para recalcular."
            )
        return selected

    return await run_in_threadpool(read)
