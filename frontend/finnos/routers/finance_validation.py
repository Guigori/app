"""Authenticated, read-only Firestore finance validation endpoint."""
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field
from finnos.lib.money import FinanceModel, Money
from finnos.lib.reconciliation_preview import compare_invoice_evidence, compare_account_evidence
from finnos.lib.dates import today_iso
from starlette.concurrency import run_in_threadpool
from finnos.lib.db import db
from finnos.lib.finance_audit import KINDS, audit_finance
from finnos.routers.auth import require_user

router = APIRouter(prefix="/finance", tags=["finance-validation"])


@router.get("/integrity")
async def validation(user: dict = Depends(require_user)):
    uid = user["id"]
    records = {}
    for kind in KINDS:
        records[kind] = await getattr(db, kind).find({"user_id": uid}).to_list(20000)
    return audit_finance(records)


class InvoiceEvidenceIn(FinanceModel):
    card_id: str = Field(min_length=1, max_length=1500)
    cycle: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    declared_invoice_total: Money = Field(ge=0)
    declared_paid: Money = Field(ge=0)
    reference: str | None = Field(default=None, max_length=100)


class AccountEvidenceIn(FinanceModel):
    account_id: str = Field(min_length=1, max_length=1500)
    statement_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    statement_balance: Money
    reference: str | None = Field(default=None, max_length=100)


class ReconciliationPreviewIn(FinanceModel):
    invoices: list[InvoiceEvidenceIn] = Field(default_factory=list, max_length=100)
    accounts: list[AccountEvidenceIn] = Field(default_factory=list, max_length=100)


@router.post("/reconciliation/preview")
async def reconciliation_preview(
    input: ReconciliationPreviewIn, user: dict = Depends(require_user)
):
    """Compare imported statement amounts with current UID-scoped records.

    Strictly read only. The caller's statement is not authenticated evidence
    of a historical bank debit; never change a card cycle or bank balance.
    """
    if not input.accounts and not input.invoices:
        raise HTTPException(422, "Informe pelo menos uma fatura ou conta.")
    for item in input.accounts:
        try:
            statement = date.fromisoformat(item.statement_date)
        except ValueError as exc:
            raise HTTPException(422, "Data de extrato inválida.") from exc
        if statement > date.fromisoformat(today_iso()):
            raise HTTPException(422, "Extrato futuro não é uma conciliação histórica.")
    uid = user["id"]
    cards = await db.cards.find({"user_id": uid}).to_list(200) if input.invoices else []
    accounts = await db.accounts.find({"user_id": uid}).to_list(500) if input.accounts else []
    txs = await db.transactions.find({"user_id": uid}).to_list(20000)
    invoices = compare_invoice_evidence(
        cards, txs, [item.model_dump() for item in input.invoices]
    )
    accounts_report = compare_account_evidence(
        accounts, txs, [item.model_dump() for item in input.accounts]
    )
    return {
        **invoices,
        "accounts": accounts_report,
        "review_count": invoices["review_count"] + accounts_report["review_count"],
        "matched_count": invoices["matched_count"] + accounts_report["matched_count"],
        "migration_reconciled": False,
        "writes_data": False,
    }


@router.get("/history")
async def finance_history(
    limit: int = Query(default=50, ge=1, le=100),
    before: str | None = Query(default=None, max_length=40),
    user: dict = Depends(require_user),
):
    """Newest financial changes, scoped to Firebase UID, with cursor pagination.

    History is read-only. FINN's destructive SQL undo is deliberately not
    transferred to Firestore or applied to settled bank transactions.
    """
    from finnos.lib import db as store
    from firebase_admin import firestore

    if before:
        try:
            datetime.fromisoformat(before)
        except ValueError as exc:
            raise HTTPException(422, "Cursor de histórico inválido.") from exc

    uid = store.scoped({"user_id": user["id"]})

    def read():
        collection = store.root(store.client(), uid).collection("finance_history")
        query = collection.order_by(
            "created_at", direction=firestore.Query.DESCENDING
        )
        if before:
            query = query.where("created_at", "<", before)
        items = [
            {"id": snapshot.id, **snapshot.to_dict()}
            for snapshot in query.limit(limit + 1).stream(timeout=15)
        ]
        has_more = len(items) > limit
        items = items[:limit]
        return {
            "items": items,
            "next_cursor": items[-1]["created_at"] if has_more and items else None,
        }

    return await run_in_threadpool(read)
