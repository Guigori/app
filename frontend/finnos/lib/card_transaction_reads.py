"""ARQ-02/03: UID-scoped paginated card purchases for read-only invoices.

The API cannot drop old installment purchases: the current invoice might
include their last installment years later. Filtering by card_id (a Firestore
single-field index) avoids reading unrelated purchases and banking movements.
"""
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib.account_balances import PAGE_SIZE, _revision


async def read_card_purchases(
    user_id: str, card_id: str, expected_revision: int,
) -> list[dict]:
    store.scoped({"user_id": user_id})
    store.resource_id(card_id)

    def read():
        parent = store.root(store.client(), user_id)
        collection = parent.collection("transactions")
        results = []
        previous = None
        previous_id = None
        while True:
            # Single-field card_id index; __name__ provides a stable cursor.
            query = collection.where("card_id", "==", card_id).order_by("__name__")
            if previous is not None:
                query = query.start_after(previous)
            snapshots = list(query.limit(PAGE_SIZE).stream(timeout=15))
            if len(snapshots) > PAGE_SIZE:
                raise HTTPException(503, "Página de fatura inválida.")
            for snap in snapshots:
                if previous_id is not None and snap.id <= previous_id:
                    raise HTTPException(503, "Ordenação de fatura inválida.")
                raw = snap.to_dict()
                if not isinstance(raw, dict):
                    raise HTTPException(503, "Compra histórica inválida.")
                if raw.get("card_id") != card_id:
                    raise HTTPException(503, "Compra vinculada a cartão inesperado.")
                results.append(dict(store.decode(raw), id=snap.id, user_id=user_id))
                previous_id = snap.id
            if len(snapshots) < PAGE_SIZE:
                break
            previous = snapshots[-1]
        if _revision(parent) != expected_revision:
            raise HTTPException(
                409, "Fatura alterada durante a consulta; atualize para recalcular."
            )
        return results

    return await run_in_threadpool(read)
