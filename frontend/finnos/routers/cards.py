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
from finnos.models.notify import Invoice, InvoiceItem, PayInvoiceIn, CreditInvoiceIn, BankRefundIn
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
    from finnos.lib.invoices import commitment, invoice_state, default_invoice_cycle
    current, future_cents, used_cents = commitment(doc, txs, closing.isoformat())
    payable_cycle = default_invoice_cycle(doc, txs, today)
    payable_state = invoice_state(doc, txs, payable_cycle)

    invoice, future, used = D(current)/100, D(future_cents)/100, D(used_cents)/100
    limit = D(doc["limit"])
    account = accounts.get(doc.get("payment_account_id") or "", {})
    return CardOut(
        version=doc.get("version", 1),
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
        payable_invoice=D(max(0, payable_state["total_cents"] - payable_state["paid_cents"])) / 100,
        payable_cycle=payable_cycle,
        payable_due=payable_state["due_date"],
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


async def _context_all_cards(user_id: str, cards: List[dict]) -> tuple[dict, dict]:
    """Read only indexed per-card purchases; no global 20k-document scan.

    A final revision read covers the entire series of card queries, so a
    concurrent purchase or invoice payment cannot mix cards from two states.
    """
    from finnos.lib.account_balances import finance_revision
    from finnos.lib.card_transaction_reads import read_card_purchases
    revision = await finance_revision(user_id)
    accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
    by_card = {}
    for card in cards:
        by_card[card["id"]] = await read_card_purchases(user_id, card["id"], revision)
    if await finance_revision(user_id) != revision:
        raise HTTPException(
            409, "Cartões alterados durante a consulta; atualize para recalcular."
        )
    return by_card, {a["id"]: a for a in accounts}


async def _context(user_id: str) -> tuple[List[dict], dict]:
    """Backward-compatible Radar/Simulation context, indexed by card.

    These consumers still receive a flat purchase list, but this helper never
    scans bank transactions or imposes the old 20k limit across all cards.
    """
    docs = await db.cards.find({"user_id": user_id}).to_list(200)
    purchases, accounts = await _context_all_cards(user_id, docs)
    return [tx for doc in docs for tx in purchases[doc["id"]]], accounts


async def _context_one_card(user_id: str, card_id: str) -> tuple[List[dict], dict]:
    """Return only one card's purchases after an UID-scoped revision check.

    Creating or editing a card must not reread every transaction from all
    the user's other cards and bank accounts.
    """
    from finnos.lib.account_balances import finance_revision
    from finnos.lib.card_transaction_reads import read_card_purchases

    revision = await finance_revision(user_id)
    accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
    purchases = await read_card_purchases(user_id, card_id, revision)
    return purchases, {a["id"]: a for a in accounts}


@router.get("", response_model=List[CardOut])
async def list_cards(user: dict = Depends(require_user)) -> List[CardOut]:
    # Read the revision before the cards themselves as well as the purchases.
    from finnos.lib.account_balances import finance_revision
    start_revision = await finance_revision(user["id"])
    docs = (
        await db.cards.find({"user_id": user["id"]}).sort("created_at", 1).to_list(200)
    )
    by_card, accounts = await _context_all_cards(user["id"], docs)
    if await finance_revision(user["id"]) != start_revision:
        raise HTTPException(409, "Cartões alterados durante a consulta; tente novamente.")
    return [await _build(doc, by_card[doc["id"]], accounts) for doc in docs]


@router.post("", response_model=CardOut, status_code=201)
async def create_card(payload: CardIn, user: dict = Depends(require_user), x_finnos_operation_id: str | None = Header(default=None, min_length=1, max_length=80)) -> CardOut:
    """Create a UID-scoped Firestore card, checking payment account ownership atomically."""
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        **payload.model_dump(),
        **({"operation_id": x_finnos_operation_id} if x_finnos_operation_id else {}),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.cards.insert_one(doc)
    txs, accounts = await _context_one_card(user["id"], doc["id"])
    return await _build(doc, txs, accounts)


@router.put("/{card_id}", response_model=CardOut)
async def update_card(card_id: str, payload: CardIn, user: dict = Depends(require_user),
    x_finnos_operation_id: str | None = Header(default=None, min_length=1, max_length=80),
    x_finnos_base_version: int | None = Header(default=None, ge=1)) -> CardOut:
    """Update only the authenticated user's card; preserve metadata and cycle state."""
    result = await db.cards.update_one(
        {"id": card_id, "user_id": user["id"],
         "_operation_id": x_finnos_operation_id,
         "_expected_version": x_finnos_base_version},
        {"$set": {**payload.model_dump(), "updated_at": datetime.now(timezone.utc)}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Cartão não encontrado.")
    doc = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
    txs, accounts = await _context_one_card(user["id"], doc["id"])
    return await _build(doc, txs, accounts)


@router.delete("/{card_id}", status_code=204, response_class=Response)
async def delete_card(card_id: str, user: dict = Depends(require_user),
    x_finnos_operation_id: str | None = Header(default=None, min_length=1, max_length=80),
    x_finnos_base_version: int | None = Header(default=None, ge=1)) -> Response:
    """Reject deletion when linked transactions exist; never orphan card references."""
    result = await db.cards.delete_one({"id": card_id, "user_id": user["id"],
         "_operation_id": x_finnos_operation_id,
         "_expected_version": x_finnos_base_version})
    if not result.deleted_count:
        raise HTTPException(404, "Cartão não encontrado.")
    return Response(status_code=204)


@router.get("/{card_id}/invoice", response_model=Invoice)
async def card_invoice(card_id: str, cycle: str | None = Query(None), user: dict = Depends(require_user)):
    from finnos.lib.invoices import invoice_state, output, default_invoice_cycle
    from finnos.lib.account_balances import finance_revision
    from finnos.lib.card_transaction_reads import read_card_purchases

    revision = await finance_revision(user["id"])
    card = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
    if not card:
        raise HTTPException(404, "Cartão não encontrado.")
    txs = await read_card_purchases(user["id"], card_id, revision)
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
    from finnos.lib.history import record_event
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
            txs = store.card_purchase_rows(instance, uid, card_id, tr)
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
            record_event(tr, owner, "transactions", "created", None, debit)
            tr.set(card_ref,store.encode(card))
            # Invoice settlements change card state; a replay must rebuild
            # the corresponding shadow rather than assume transaction-only deltas.
            from finnos.lib.finance_shadow_outbox import capture_event
            capture_event("cards", "updated", {"id": card_id}, {"id": card_id})
            tr.create(receipt_ref,dict(request=request_key,state=state,created_at=now))
            return response
        return store.atomic(instance,uid,action)
    return await run_in_threadpool(execute)


@router.post("/{card_id}/credits", response_model=Invoice)
async def credit_invoice(
    card_id: str,
    payload: CreditInvoiceIn,
    user: dict = Depends(require_user),
    x_finnos_operation_id: str = Header(...),
):
    """Record an immutable, idempotent purchase credit on an unpaid invoice.

    Credit notes only reduce unpaid card debt; they never silently reimburse a
    bank account or delete purchases/payment transactions. All writes are
    UID-scoped and serialized inside the existing Firestore card transaction.
    """
    import hashlib
    import json
    from finnos.lib import db as store
    from finnos.lib.invoice_credits import validate_credit, append_credit
    from finnos.lib.history import record_event
    from finnos.lib.invoice_payments import to_cents
    from finnos.lib.invoices import invoice_state, output
    from starlette.concurrency import run_in_threadpool

    if not 1 <= len(x_finnos_operation_id) <= 200:
        raise HTTPException(422, "Identificador de operação inválido.")
    reason = payload.reason.strip()
    if len(reason) < 5:
        raise HTTPException(422, "Descreva o motivo do estorno.")
    try:
        amount = to_cents(payload.value)
        # Also validate the requested closing-cycle date before reading storage.
        date.fromisoformat(payload.cycle)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    uid = store.scoped({"user_id": user["id"]})
    entry_id = hashlib.sha256(
        f"invoice-credit:{uid}:{card_id}:{x_finnos_operation_id}".encode()
    ).hexdigest()
    request_key = {
        "card_id": card_id,
        "cycle": payload.cycle,
        "purchase_id": payload.purchase_id,
        "amount_cents": amount,
        "reason": reason,
    }
    fingerprint = hashlib.sha256(
        json.dumps(request_key, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()

    def execute():
        instance = store.client()

        def action(tr):
            owner = store.root(instance, uid)
            card_ref = owner.collection("cards").document(store.resource_id(card_id))
            snap = card_ref.get(transaction=tr)
            if not snap.exists:
                raise HTTPException(404, "Cartão não encontrado.")
            card = dict(store.decode(snap.to_dict()), id=card_id)
            previous = next((
                item for entries in (card.get("invoice_adjustments") or {}).values()
                for item in entries if item.get("id") == entry_id
            ), None)
            txs = store.card_purchase_rows(instance, uid, card_id, tr)
            if previous is not None:
                if previous.get("fingerprint") != fingerprint:
                    raise HTTPException(409, "Identificador reutilizado para outro estorno.")
                return output(invoice_state(card, txs, payload.cycle))

            try:
                validate_credit(card, txs, payload.cycle, payload.purchase_id, amount)
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc

            now = datetime.now(timezone.utc)
            append_credit(card, {
                "id": entry_id,
                "fingerprint": fingerprint,
                "cycle": payload.cycle,
                "purchase_id": payload.purchase_id,
                "credit_cents": amount,
                "reason": reason,
                "date": today_iso(),
                "created_at": now,
            })
            # Only update the card's credit ledger; do not rewrite purchases,
            # payment receipts, accounts or any other user collection.
            tr.update(card_ref, {"invoice_adjustments": card["invoice_adjustments"]})
            record_event(
                tr, owner, "cards", "updated",
                {"id": card_id, "name": card["name"]},
                {"id": card_id, "name": card["name"],
                 "credit_amount": D(amount) / 100},
            )
            return output(invoice_state(card, txs, payload.cycle))

        return store.atomic(instance, uid, action)

    return await run_in_threadpool(execute)


@router.post("/{card_id}/refunds", response_model=Invoice)
async def bank_refund_invoice(
    card_id: str,
    payload: BankRefundIn,
    user: dict = Depends(require_user),
    x_finnos_operation_id: str = Header(...),
):
    """Reimburse a settled card purchase through a real bank account.

    The invoice remains paid, the purchase remains immutable, and a separate
    bank receipt is created atomically with the append-only refund record.
    """
    import hashlib
    import json
    from starlette.concurrency import run_in_threadpool
    from finnos.lib import db as store
    from finnos.lib.invoice_refunds import validate_bank_refund, append_refund
    from finnos.lib.invoice_payments import to_cents
    from finnos.lib.invoices import invoice_state, output
    from finnos.lib.history import record_event

    if not 1 <= len(x_finnos_operation_id) <= 200:
        raise HTTPException(422, "Identificador de operação inválido.")
    try:
        refund_date = date.fromisoformat(payload.date)
        date.fromisoformat(payload.cycle)
        amount = to_cents(payload.value)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if refund_date > date.fromisoformat(today_iso()):
        raise HTTPException(422, "Reembolso realizado não pode ter data futura.")
    reason = payload.reason.strip()
    if len(reason) < 5:
        raise HTTPException(422, "Descreva o motivo do reembolso.")

    uid = store.scoped({"user_id": user["id"]})
    refund_id = hashlib.sha256(
        f"bank-refund:{uid}:{card_id}:{x_finnos_operation_id}".encode()
    ).hexdigest()
    request_data = {
        "cycle": payload.cycle, "purchase_id": payload.purchase_id,
        "account_id": payload.account_id, "date": payload.date,
        "reason": reason, "refund_cents": amount,
    }
    fingerprint = hashlib.sha256(
        json.dumps(request_data, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()

    def execute():
        instance = store.client()

        def action(tr):
            parent = store.root(instance, uid)
            card_ref = parent.collection("cards").document(store.resource_id(card_id))
            snap = card_ref.get(transaction=tr)
            if not snap.exists:
                raise HTTPException(404, "Cartão não encontrado.")
            card = dict(store.decode(snap.to_dict()), id=card_id)
            previous = next((
                entry for entries in (card.get("invoice_refunds") or {}).values()
                for entry in entries if entry["id"] == refund_id
            ), None)
            txs = store.card_purchase_rows(instance, uid, card_id, tr)
            if previous:
                if previous.get("fingerprint") != fingerprint:
                    raise HTTPException(409, "Identificador de reembolso reutilizado.")
                return output(invoice_state(card, txs, payload.cycle))

            account = parent.collection("accounts").document(
                store.resource_id(payload.account_id)
            ).get(transaction=tr)
            if not account.exists:
                raise HTTPException(400, "Conta bancária inválida.")
            try:
                validate_bank_refund(card, txs, payload.cycle, payload.purchase_id, amount)
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc

            now = datetime.now(timezone.utc)
            append_refund(card, {
                "id": refund_id, "cycle": payload.cycle,
                "purchase_id": payload.purchase_id,
                "account_id": payload.account_id, "refund_cents": amount,
                "date": payload.date, "reason": reason,
                "fingerprint": fingerprint, "created_at": now,
            })
            receipt = {
                "id": refund_id, "user_id": uid,
                "name": f"Reembolso {card['name']}", "value": D(amount) / 100,
                "type": "receita", "status": "pago", "date": payload.date,
                "account_id": payload.account_id, "card_id": None,
                "to_account_id": None, "category_id": None,
                "fixed": False, "installment": False,
                "invoice_refund": True, "invoice_card_id": card_id,
                "invoice_cycle": payload.cycle, "original_purchase_id": payload.purchase_id,
                "created_at": now, "updated_at": now, "version": 1,
            }
            tr.create(parent.collection("transactions").document(refund_id), store.encode(receipt))
            tr.update(card_ref, {"invoice_refunds": store.encode(card["invoice_refunds"])})
            from finnos.lib.finance_shadow_outbox import capture_event
            capture_event("cards", "updated", {"id": card_id}, {"id": card_id})
            record_event(tr, parent, "transactions", "created", None, receipt)
            return output(invoice_state(card, txs, payload.cycle))

        return store.atomic(instance, uid, action)
    return await run_in_threadpool(execute)
