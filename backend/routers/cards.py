"""Credit cards: CRUD plus the derived invoice/limit/cycle numbers for each card."""

import uuid
from datetime import date, datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response

from lib.cards import best_purchase_day, cycle_bounds, due_date
from lib.db import db
from lib.dates import today_iso
from lib.stats import aware, months_between
from models.cards import CardIn, CardOut
from models.notify import Invoice, InvoiceItem, PayInvoiceIn
from routers.auth import require_user

router = APIRouter(prefix="/cards", tags=["cards"])


def _occurrence_value(tx: dict) -> float:
    if tx.get("installment"):
        return round(float(tx.get("installment_value") or 0.0), 2)
    return round(float(tx["value"]), 2)


async def _build(doc: dict, txs: List[dict], accounts: dict) -> CardOut:
    today = date.fromisoformat(today_iso())
    start, closing = cycle_bounds(today, doc["closing_day"])
    due = due_date(closing, doc["closing_day"], doc["due_day"])
    best = best_purchase_day(closing)

    invoice = 0.0
    future = 0.0
    for tx in txs:
        if tx.get("card_id") != doc["id"] or tx.get("type") != "despesa":
            continue
        value = _occurrence_value(tx)
        tx_date = tx["date"]
        if tx.get("installment"):
            total = int(tx.get("total_installments") or 1)
            # One installment lands in the open cycle; the rest is limit already committed.
            offset = months_between(tx_date[:7], closing.strftime("%Y-%m"))
            if 0 <= offset < total:
                invoice += value
            remaining = max(total - max(offset + 1, 0), 0)
            future += value * remaining
        elif start.isoformat() <= tx_date <= closing.isoformat():
            invoice += value

    limit = float(doc["limit"])
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
        available=round(max(limit - used, 0.0), 2),
        used_percent=round(used / limit * 100, 1) if limit else 0.0,
        cycle_start=start.isoformat(),
        next_closing=closing.isoformat(),
        next_due=due.isoformat(),
        best_purchase_day=best.isoformat(),
        created_at=aware(doc.get("created_at")) or datetime.now(timezone.utc),
    )


async def _context(user_id: str) -> tuple[List[dict], dict]:
    txs = await db.transactions.find({"user_id": user_id, "card_id": {"$ne": None}}).to_list(20000)
    accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
    return txs, {a["id"]: a for a in accounts}


@router.get("", response_model=List[CardOut])
async def list_cards(user: dict = Depends(require_user)) -> List[CardOut]:
    docs = await db.cards.find({"user_id": user["id"]}).sort("created_at", 1).to_list(200)
    txs, accounts = await _context(user["id"])
    return [await _build(doc, txs, accounts) for doc in docs]


@router.post("", response_model=CardOut, status_code=201)
async def create_card(payload: CardIn, user: dict = Depends(require_user)) -> CardOut:
    if payload.payment_account_id:
        exists = await db.accounts.find_one({"id": payload.payment_account_id, "user_id": user["id"]})
        if not exists:
            raise HTTPException(status_code=400, detail="Conta de pagamento inválida.")
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        **payload.model_dump(),
        "created_at": datetime.now(timezone.utc),
    }
    await db.cards.insert_one(doc)
    txs, accounts = await _context(user["id"])
    return await _build(doc, txs, accounts)


@router.put("/{card_id}", response_model=CardOut)
async def update_card(card_id: str, payload: CardIn, user: dict = Depends(require_user)) -> CardOut:
    existing = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")
    if payload.payment_account_id:
        account = await db.accounts.find_one({"id": payload.payment_account_id, "user_id": user["id"]})
        if not account:
            raise HTTPException(status_code=400, detail="Conta de pagamento inválida.")
    # Patch in place: replacing the document would drop id/user_id/created_at.
    await db.cards.update_one({"id": card_id, "user_id": user["id"]}, {"$set": payload.model_dump()})
    doc = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
    txs, accounts = await _context(user["id"])
    return await _build(doc, txs, accounts)


@router.delete("/{card_id}", status_code=204, response_class=Response)
async def delete_card(card_id: str, user: dict = Depends(require_user)) -> Response:
    result = await db.cards.delete_one({"id": card_id, "user_id": user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")
    # Transactions survive the card; they just stop being tagged.
    await db.transactions.update_many(
        {"user_id": user["id"], "card_id": card_id}, {"$set": {"card_id": None}}
    )
    return Response(status_code=204)


# --- Fatura detalhada + pagamento ------------------------------------------


def _cycle_items(card: dict, txs: List[dict], categories: dict, start: str, closing: str) -> List[InvoiceItem]:
    items: List[InvoiceItem] = []
    for tx in txs:
        if tx.get("card_id") != card["id"] or tx.get("type") != "despesa":
            continue
        value = _occurrence_value(tx)
        category = categories.get(tx.get("category_id") or "", {})
        if tx.get("installment"):
            total = int(tx.get("total_installments") or 1)
            offset = months_between(tx["date"][:7], closing[:7])
            if not (0 <= offset < total):
                continue
            current = (int(tx.get("current_installment") or 1) - 1 + offset) % max(total, 1) + 1
            label = f"{min(current, total)}/{total}"
        elif start <= tx["date"] <= closing:
            label = None
        else:
            continue
        items.append(
            InvoiceItem(
                id=tx["id"],
                name=tx["name"],
                date=tx["date"],
                value=value,
                category_name=category.get("name"),
                category_color=category.get("color"),
                installment_label=label,
            )
        )
    items.sort(key=lambda i: i.date, reverse=True)
    return items


@router.get("/{card_id}/invoice", response_model=Invoice)
async def card_invoice(card_id: str, user: dict = Depends(require_user)) -> Invoice:
    """Everything inside the open cycle of this card, newest first."""
    card = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
    if not card:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")
    today = date.fromisoformat(today_iso())
    start, closing = cycle_bounds(today, card["closing_day"])
    due = due_date(closing, card["closing_day"], card["due_day"])

    txs = await db.transactions.find({"user_id": user["id"], "card_id": card_id}).to_list(5000)
    categories = {c["id"]: c for c in await db.categories.find({"user_id": user["id"]}).to_list(500)}
    items = _cycle_items(card, txs, categories, start.isoformat(), closing.isoformat())
    paid = (card.get("paid_cycles") or {}).get(closing.isoformat())

    return Invoice(
        card_id=card_id,
        card_name=card["name"],
        cycle_start=start.isoformat(),
        cycle_end=closing.isoformat(),
        due_date=due.isoformat(),
        total=round(sum(i.value for i in items), 2),
        paid=bool(paid),
        paid_amount=round(float((paid or {}).get("amount", 0.0)), 2),
        paid_at=(paid or {}).get("paid_at"),
        items=items,
    )


@router.post("/{card_id}/pay", response_model=Invoice)
async def pay_invoice(card_id: str, payload: PayInvoiceIn, user: dict = Depends(require_user)) -> Invoice:
    """Mark the open invoice as paid and post the debit on the chosen account.

    The debit is a normal "despesa" with no card tag, so it never re-enters a fatura.
    """
    card = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
    if not card:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")
    account = await db.accounts.find_one({"id": payload.account_id, "user_id": user["id"]})
    if not account:
        raise HTTPException(status_code=400, detail="Conta inválida: selecione uma conta cadastrada.")

    today = date.fromisoformat(today_iso())
    start, closing = cycle_bounds(today, card["closing_day"])
    cycle_key = closing.isoformat()
    if (card.get("paid_cycles") or {}).get(cycle_key):
        raise HTTPException(status_code=400, detail="Esta fatura já está marcada como paga.")

    txs = await db.transactions.find({"user_id": user["id"], "card_id": card_id}).to_list(5000)
    categories = {c["id"]: c for c in await db.categories.find({"user_id": user["id"]}).to_list(500)}
    items = _cycle_items(card, txs, categories, start.isoformat(), cycle_key)
    amount = round(payload.value if payload.value else sum(i.value for i in items), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Não há valor em aberto nesta fatura.")

    now = datetime.now(timezone.utc)
    debit = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "name": f"Fatura {card['name']}",
        "value": amount,
        "type": "despesa",
        "status": "pago",
        "date": payload.date,
        "account_id": payload.account_id,
        "card_id": None,
        "to_account_id": None,
        "category_id": None,
        "fixed": False,
        "recurrence": None,
        "installment": False,
        "total_installments": None,
        "current_installment": None,
        "installment_value": None,
        "adjusted_value": None,
        "attachment": None,
        "notes": f"Pagamento da fatura fechada em {cycle_key}.",
        "created_at": now,
        "updated_at": now,
    }
    await db.transactions.insert_one(debit)
    await db.cards.update_one(
        {"id": card_id, "user_id": user["id"]},
        {
            "$set": {
                f"paid_cycles.{cycle_key}": {
                    "amount": amount,
                    "transaction_id": debit["id"],
                    "paid_at": payload.date,
                }
            }
        },
    )
    return await card_invoice(card_id, user)
