"""ARQ-02: read-only Firestore rebuild and independent shadow reconciliation.

No route reads these candidate documents and this module has no write calls.
The second pass compares snapshot cents with FinancialWindow (the existing
Dashboard compiler), guarded by the same UID finance revision throughout.
"""
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib.account_balances import PAGE_SIZE, _revision
from finnos.lib.financial_summaries import FinancialWindow
from finnos.lib.monthly_aggregate_shadow import (
    IncrementalMonthlyLedger, SCHEMA_VERSION, snapshot_checksum,
    transaction_months,
)
from finnos.lib.money import cents
from finnos.lib.projection_reads import referenced_purchase_ids
from finnos.lib.stats import month_portion


def _stream_transactions(parent, user_id: str):
    collection = parent.collection("transactions")
    last, last_id = None, None
    while True:
        query = collection.order_by("__name__")
        if last is not None:
            query = query.start_after(last)
        page = list(query.limit(PAGE_SIZE).stream(timeout=15))
        if len(page) > PAGE_SIZE:
            raise HTTPException(503, "Página do agregado inválida.")
        for snap in page:
            if last_id is not None and snap.id <= last_id:
                raise HTTPException(503, "Histórico fora de ordem.")
            raw = snap.to_dict()
            if not isinstance(raw, dict):
                raise HTTPException(503, "Movimento financeiro inválido.")
            yield dict(store.decode(raw), id=snap.id, user_id=user_id)
            last_id = snap.id
        if len(page) < PAGE_SIZE:
            break
        last = page[-1]


async def build_shadow_candidate(
    user_id: str, cards: list[dict], expected_revision: int,
) -> dict:
    """Fold a complete UID history into a *non-certified*, in-memory snapshot."""
    store.scoped({"user_id": user_id})

    def read():
        parent = store.root(store.client(), user_id)
        engine = IncrementalMonthlyLedger()
        needed_originals = referenced_purchase_ids(cards)
        originals = {}
        count = 0
        for tx in _stream_transactions(parent, user_id):
            engine.transaction_changed(None, tx)
            if tx["id"] in needed_originals:
                originals[tx["id"]] = tx
            count += 1
        try:
            for card in cards:
                engine.card_credits_changed(None, card, originals)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        if _revision(parent) != expected_revision:
            raise HTTPException(409, "Histórico alterado durante o recálculo.")
        snapshot = engine.snapshot(expected_revision)
        snapshot["source_count"] = count
        return snapshot

    return await run_in_threadpool(read)


async def check_shadow_candidate(
    user_id: str, cards: list[dict], expected_revision: int, candidate: dict,
) -> dict:
    """Second independent full scan; compare every financial month in cents.

    The result is diagnostic only. A matching report is *not* authorization to
    replace live read paths or enable automatic writes.
    """
    store.scoped({"user_id": user_id})
    if (candidate.get("schema_version") != SCHEMA_VERSION
            or candidate.get("finance_revision") != expected_revision
            or candidate.get("status") != "shadow_only"
            or candidate.get("checksum") != snapshot_checksum(candidate)):
        raise HTTPException(409, "Agregado não certificado ou desatualizado.")

    def read():
        parent = store.root(store.client(), user_id)
        months = sorted(candidate["months"])
        window = FinancialWindow(months, cards)
        touched = set()
        source_count = 0
        for tx in _stream_transactions(parent, user_id):
            window.add(tx)
            source_count += 1
            # An expected month absent from candidate must also fail.
            for month in transaction_months(tx):
                if month_portion(tx, month) is not None:
                    touched.add(month)
        for card in cards:
            for key in ("invoice_adjustments", "invoice_refunds"):
                for entries in (card.get(key) or {}).values():
                    for credit in entries:
                        touched.add(credit["date"][:7])
        window.finalize()
        if _revision(parent) != expected_revision:
            raise HTTPException(409, "Histórico alterado durante a reconciliação.")
        mismatches = {}
        for month in sorted(set(months) | touched):
            value = window.monthly(month) if month in candidate["months"] else {
                "income": 0, "expense": 0, "count": 0, "by_category": {},
            }
            expected = {
                "income_cents": cents(value["income"]),
                "expense_cents": cents(value["expense"]),
                "count": value["count"],
                "categories_cents": {
                    (identifier or ""): cents(total)
                    for identifier, total in value["by_category"].items()
                    if cents(total)
                },
            }
            actual = candidate["months"].get(month, {
                "income_cents": 0, "expense_cents": 0,
                "count": 0, "categories_cents": {},
            })
            if expected != actual or month not in months:
                mismatches[month] = {"original": expected, "shadow": actual}
        if candidate.get("source_count") != source_count:
            mismatches["source_count"] = {
                "original": source_count, "shadow": candidate.get("source_count")
            }
        return {
            "match": not mismatches, "finance_revision": expected_revision,
            "checked_months": sorted(set(months) | touched),
            "source_count": source_count, "diffs": mismatches,
            "production_eligible": False,
        }

    return await run_in_threadpool(read)
