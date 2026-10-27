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
from finnos.lib.account_balances import PAGE_SIZE, _revision


def projection_relevant(tx: dict, months: frozenset[str], originals: frozenset[str]) -> bool:
    return (
        tx.get("fixed") is True
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
        collection = parent.collection("transactions")
        selected = []
        last = None
        last_id = None
        while True:
            query = collection.order_by("__name__")
            if last is not None:
                query = query.start_after(last)
            snapshots = list(query.limit(PAGE_SIZE).stream(timeout=15))
            if len(snapshots) > PAGE_SIZE:
                raise HTTPException(503, "Página de projeção inválida.")
            for snap in snapshots:
                if last_id is not None and snap.id <= last_id:
                    raise HTTPException(503, "Ordenação da projeção inválida.")
                raw = snap.to_dict()
                if not isinstance(raw, dict):
                    raise HTTPException(503, "Registro financeiro inválido.")
                # Filter cheap date/series flags before decoding monetary fields.
                # Referenced originals must never be lost to this predicate.
                candidate = dict(raw, id=snap.id)
                if projection_relevant(candidate, periods, originals):
                    selected.append(
                        dict(store.decode(raw), id=snap.id, user_id=user_id)
                    )
                last_id = snap.id
            if len(snapshots) < PAGE_SIZE:
                break
            last = snapshots[-1]
        if _revision(parent) != expected_revision:
            raise HTTPException(
                409, "Histórico alterado durante a projeção; atualize para recalcular."
            )
        return selected

    return await run_in_threadpool(read)
