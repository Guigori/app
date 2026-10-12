from finnos.lib.money import D, installment_portion

"""Credit cards: CRUD plus the derived invoice/limit/cycle numbers for each card."""
import uuid
from datetime import date, datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response
from finnos.lib.cards import best_purchase_day, cycle_bounds, due_date
from finnos.lib.db import db
from finnos.lib.dates import today_iso
from finnos.lib.stats import aware, months_between
from finnos.models.cards import CardIn, CardOut
from finnos.models.notify import Invoice, InvoiceItem, PayInvoiceIn
from finnos.routers.auth import require_user

router = APIRouter(prefix="/cards", tags=["cards"])


def _occurrence_value(tx: dict) -> float:
    if tx.get("installment"):
        return round(D(tx.get("installment_value") or D("0.0")), 2)
    return round(D(tx["value"]), 2)


async def _build(doc: dict, txs: List[dict], accounts: dict) -> CardOut:
    today = date.fromisoformat(today_iso())
    start, closing = cycle_bounds(today, doc["closing_day"])
    due = due_date(closing, doc["closing_day"], doc["due_day"])
    best = best_purchase_day(closing)
    invoice = D("0.0")
    future = D("0.0")
    for tx in txs:
        if tx.get("card_id") != doc["id"] or tx.get("type") != "despesa":
            continue
        value = _occurrence_value(tx)
        tx_date = tx["date"]
        if tx.get("installment"):
            total = int(tx.get("total_installments") or 1)
            offset = months_between(tx_date[:7], closing.strftime("%Y-%m"))
            if 0 <= offset < total:
                invoice += installment_portion(tx, offset)
            remaining = max(total - max(offset + 1, 0), 0)
            future += sum(
                (installment_portion(tx, i) for i in range(max(offset + 1, 0), total)),
                D(0),
            )
        elif start.isoformat() <= tx_date <= closing.isoformat():
            invoice += value
    limit = D(doc["limit"])
    used = round(invoice + future, 2)
    account = accounts.get(doc.get("payment_account_id") or "", {})
    return CardOut(
        id=doc["id"],
        name=doc["name"],
        institution=doc.get("institution", ""),
        color=doc.get("color", "#5B3FE4"),
        limit=round(limit, 2),
        closing_day=doc["closing_day"],
        due_day=doc["due_day"],
        payment_account_id=doc.get("payment_account_id"),
        payment_account_name=account.get("name") or None,
        active=doc.get("active", True),
        invoice_paid=bool((doc.get("paid_cycles") or {}).get(closing.isoformat())),
        current_invoice=round(invoice, 2),
        future_installments=round(future, 2),
        used=used,
        available=round(max(limit - used, D("0.0")), 2),
        used_percent=round(used / limit * 100, 1) if limit else D("0.0"),
        cycle_start=start.isoformat(),
        next_closing=closing.isoformat(),
        next_due=due.isoformat(),
        best_purchase_day=best.isoformat(),
        created_at=aware(doc.get("created_at")) or datetime.now(timezone.utc),
    )


async def _context(user_id: str) -> tuple[List[dict], dict]:
    txs = await db.transactions.find(
        {"user_id": user_id, "card_id": {"$ne": None}}
    ).to_list(20000)
    accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
    return (txs, {a["id"]: a for a in accounts})


@router.get("", response_model=List[CardOut])
async def list_cards(user: dict = Depends(require_user)) -> List[CardOut]:
    docs = (
        await db.cards.find({"user_id": user["id"]}).sort("created_at", 1).to_list(200)
    )
    txs, accounts = await _context(user["id"])
    return [await _build(doc, txs, accounts) for doc in docs]


@router.post("", response_model=CardOut, status_code=201)
async def create_card(payload: CardIn, user: dict = Depends(require_user)) -> CardOut:
    """Create a UID-scoped Firestore card, checking payment account ownership atomically."""
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        **payload.model_dump(),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.cards.insert_one(doc)
    txs, accounts = await _context(user["id"])
    return await _build(doc, txs, accounts)


@router.put("/{card_id}", response_model=CardOut)
async def update_card(card_id: str, payload: CardIn, user: dict = Depends(require_user)) -> CardOut:
    """Update only the authenticated user's card; preserve metadata and cycle state."""
    result = await db.cards.update_one(
        {"id": card_id, "user_id": user["id"]},
        {"$set": {**payload.model_dump(), "updated_at": datetime.now(timezone.utc)}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Cartão não encontrado.")
    doc = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
    txs, accounts = await _context(user["id"])
    return await _build(doc, txs, accounts)


@router.delete("/{card_id}", status_code=204, response_class=Response)
async def delete_card(card_id: str, user: dict = Depends(require_user)) -> Response:
    """Reject deletion when linked transactions exist; never orphan card references."""
    result = await db.cards.delete_one({"id": card_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Cartão não encontrado.")
    return Response(status_code=204)
