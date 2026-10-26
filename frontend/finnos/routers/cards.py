from finnos.lib.money import D, installment_portion

"""Credit cards: CRUD plus the derived invoice/limit/cycle numbers for each card."""
import uuid
from datetime import date, datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response, Header, Query
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
    from finnos.lib.invoices import commitment, invoice_state
    current, future_cents, used_cents = commitment(doc, txs, closing.isoformat())
    invoice, future, used = D(current)/100, D(future_cents)/100, D(used_cents)/100
    limit = D(doc["limit"])
    account = accounts.get(doc.get("payment_account_id") or "", {})
    return CardOut(
        id=doc["id"],
        name=doc["name"],
        institution=doc.get("institution", ""),
        institution_id=doc.get("institution_id"),
        color=doc.get("color", "#5B3FE4"),
        limit=round(limit, 2),
        closing_day=doc["closing_day"],
        due_day=doc["due_day"],
        payment_account_id=doc.get("payment_account_id"),
        payment_account_name=account.get("name") or None,
        active=doc.get("active", True),
        invoice_paid=invoice_state(doc, txs, closing.isoformat())["paid"],
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


@router.get("/{card_id}/invoice", response_model=Invoice)
async def card_invoice(card_id: str, cycle: str | None = Query(None), user: dict = Depends(require_user)):
    from finnos.lib.invoices import invoice_state, output, default_invoice_cycle
    card = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
    if not card:
        raise HTTPException(404, "Cartão não encontrado.")
    txs = await db.transactions.find({"user_id": user["id"], "card_id": card_id}).to_list(20000)
    closing = cycle or default_invoice_cycle(card, txs, date.fromisoformat(today_iso()))
    categories = {c["id"]: c for c in await db.categories.find({"user_id": user["id"]}).to_list(500)}
    try:
        return output(invoice_state(card, txs, closing, categories))
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/{card_id}/pay", response_model=Invoice)
async def pay_invoice(card_id: str, payload: PayInvoiceIn, user: dict = Depends(require_user), x_finnos_operation_id: str = Header(...)):
    from finnos.lib import db as store
    from finnos.lib.invoices import invoice_state, output, default_invoice_cycle
    from finnos.lib.invoice_payments import allocate_payment, to_cents
    from starlette.concurrency import run_in_threadpool
    import hashlib
    if not 1 <= len(x_finnos_operation_id) <= 200:
        raise HTTPException(422, "Identificador de operação inválido.")
    try:
        paid_on = date.fromisoformat(payload.date)
    except ValueError:
        raise HTTPException(422, "Data inválida.")
    if paid_on > date.fromisoformat(today_iso()):
        raise HTTPException(422, "Pagamento realizado não pode ter data futura.")
    uid = store.scoped({"user_id":user["id"]})
    request_key = {"card_id":card_id, "account_id":payload.account_id, "date":payload.date, "cycle":payload.cycle, "value_cents":None if payload.value is None else to_cents(payload.value)}
    identifier = hashlib.sha256(x_finnos_operation_id.encode()).hexdigest()
    def execute():
        instance = store.client()
        def action(tr):
            owner = store.root(instance,uid)
            card_ref = owner.collection("cards").document(store.resource_id(card_id))
            snapshot = card_ref.get(transaction=tr)
            if not snapshot.exists:
                raise HTTPException(404,"Cartão não encontrado.")
            card = dict(store.decode(snapshot.to_dict()),id=card_id)
            receipt_ref = owner.collection("invoice_payments").document(identifier)
            receipt = receipt_ref.get(transaction=tr)
            if receipt.exists:
                saved = receipt.to_dict()
                if saved["request"] != request_key:
                    raise HTTPException(409,"Operação reutilizada com dados diferentes.")
                return output(saved["state"])
            acc = owner.collection("accounts").document(store.resource_id(payload.account_id)).get(transaction=tr)
            if not acc.exists:
                raise HTTPException(400,"Conta de pagamento inválida.")
            txs = store.rows(instance,uid,"transactions",tr)
            cats = {c['id']:c for c in store.rows(instance,uid,"categories",tr)}
            cycle = payload.cycle or default_invoice_cycle(card,txs,date.fromisoformat(today_iso()))
            try:
                state = invoice_state(card,txs,cycle,cats)
                allocation = allocate_payment(state['total_cents'],[state['paid_cents']] if state['paid_cents'] else [],None if payload.value is None else to_cents(payload.value))
            except ValueError as exc:
                raise HTTPException(400,str(exc))
            now = datetime.now(timezone.utc)
            # Immutable bank debit; excluded from expense analytics to avoid counting the purchase twice.
            debit = dict(id=identifier,user_id=uid,name=f"Fatura {card['name']}",value=D(allocation['payment_cents'])/100,type='despesa',status='pago',date=payload.date,account_id=payload.account_id,card_id=None,to_account_id=None,category_id=None,fixed=False,installment=False,invoice_payment=True,invoice_card_id=card_id,invoice_cycle=cycle,created_at=now,updated_at=now)
            state.update(paid_cents=allocation['paid_cents'],paid=allocation['settled'],paid_at=payload.date)
            card.setdefault('invoice_cycles',{})[cycle] = dict(items=state['items'],paid_cents=state['paid_cents'],paid_at=payload.date)
            response = output(state)
            tr.create(owner.collection('transactions').document(identifier),store.encode(debit))
            tr.set(card_ref,store.encode(card))
            tr.create(receipt_ref,dict(request=request_key,state=state,created_at=now))
            return response
        return store.atomic(instance,uid,action)
    return await run_in_threadpool(execute)
