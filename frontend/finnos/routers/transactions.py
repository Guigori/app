from finnos.lib.money import D, cents, installment_portion, quantize_brl

"""Transactions CRUD — filters, installment math and server-side enrichment."""
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Literal
import hashlib
import json
from pydantic import Field
from starlette.concurrency import run_in_threadpool
from finnos.lib.money import FinanceModel, Money
from finnos.lib import db as store
from finnos.lib.history import record_event
from finnos.lib.recurrence_scopes import plan_recurrence_edit
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from finnos.lib.db import db
from finnos.lib.stats import aware, month_bounds, paid_future_is_inconsistent
from finnos.lib.dates import today_iso
from finnos.models.finnos import TransactionIn, TransactionOut, TxStatus, TxType
from finnos.routers.auth import require_user

router = APIRouter(prefix="/transactions", tags=["transactions"])

# FNS-019: Never trust a caller-controlled financial source label. These are
# the only provenance kinds emitted by the existing FINNOS clients.
ALLOWED_OPERATION_SOURCES = frozenset({
    "manual", "ios_shortcut", "bank_notification", "import", "system",
})


def normalized_operation_source(value: str | None) -> str:
    source = value or "manual"
    if source not in ALLOWED_OPERATION_SOURCES:
        raise HTTPException(422, "Origem financeira não permitida.")
    return source



async def _ref_maps(user_id: str) -> tuple[dict, dict]:
    accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
    categories = await db.categories.find({"user_id": user_id}).to_list(500)
    return ({a["id"]: a for a in accounts}, {c["id"]: c for c in categories})


async def _cards_by_id(user_id: str) -> dict:
    cards = await db.cards.find({"user_id": user_id}).to_list(200)
    return {c["id"]: c for c in cards}


def enrich_transaction(
    doc: dict,
    accounts_by_id: dict,
    categories_by_id: dict,
    cards_by_id: dict | None = None,
) -> TransactionOut:
    account = accounts_by_id.get(doc["account_id"], {})
    to_account = accounts_by_id.get(doc.get("to_account_id") or "", {})
    category = categories_by_id.get(doc.get("category_id") or "", {})
    return TransactionOut(
        version=doc.get("version", 1),
        invoice_payment=doc.get("invoice_payment", False),
        invoice_refund=doc.get("invoice_refund", False),
        id=doc["id"],
        name=doc["name"],
        value=D(doc["value"]),
        type=doc["type"],
        status=doc.get("status", "pago"),
        date=doc["date"],
        account_id=doc["account_id"],
        account_name=account.get("name", ""),
        card_id=doc.get("card_id"),
        card_name=(cards_by_id or {}).get(doc.get("card_id") or "", {}).get("name")
        or None,
        to_account_id=doc.get("to_account_id"),
        to_account_name=to_account.get("name") or None,
        category_id=doc.get("category_id"),
        category_name=category.get("name") or None,
        category_color=category.get("color") or None,
        category_icon=category.get("icon") or None,
        fixed=doc.get("fixed", False),
        recurrence=doc.get("recurrence"),
        recurrence_id=doc.get("recurrence_id"),
        installment=doc.get("installment", False),
        total_installments=doc.get("total_installments"),
        current_installment=doc.get("current_installment"),
        installment_value=doc.get("installment_value"),
        adjusted_value=doc.get("adjusted_value"),
        attachment=doc.get("attachment"),
        notes=doc.get("notes"),
        notify_enabled=doc.get("notify_enabled", True),
        created_at=aware(doc.get("created_at")) or datetime.now(timezone.utc),
    )


async def _validate(user_id: str, payload: TransactionIn) -> None:
    accounts_by_id, categories_by_id = await _ref_maps(user_id)
    from datetime import date

    try:
        date.fromisoformat(payload.date)
    except ValueError:
        raise HTTPException(422, "Data inválida.")
    if paid_future_is_inconsistent(payload.status, payload.date, today_iso()):
        raise HTTPException(422, "Lançamento futuro não pode estar pago. Use agendado ou pendente.")
    if payload.account_id not in accounts_by_id:
        raise HTTPException(
            status_code=400, detail="Conta inválida: selecione uma conta cadastrada."
        )
    if payload.type == "transferencia":
        if payload.card_id or payload.installment:
            raise HTTPException(400, "Transferência não pode ter cartão ou parcelas.")
        if not payload.to_account_id or payload.to_account_id == payload.account_id:
            raise HTTPException(
                status_code=400,
                detail="Escolha contas diferentes para a transferência.",
            )
        if payload.to_account_id not in accounts_by_id:
            raise HTTPException(status_code=400, detail="Conta de destino inválida.")
    if payload.category_id and payload.category_id not in categories_by_id:
        raise HTTPException(status_code=400, detail="Categoria inválida.")
    if payload.card_id:
        card = await db.cards.find_one({"id": payload.card_id, "user_id": user_id})
        if not card:
            raise HTTPException(
                status_code=400,
                detail="Cartão inválido: selecione um cartão cadastrado.",
            )
    if payload.installment:
        if payload.current_installment and payload.current_installment > (
            payload.total_installments or 0
        ):
            raise HTTPException(400, "Parcela atual inválida.")
        if payload.type != "despesa":
            raise HTTPException(
                status_code=400, detail="Somente despesas podem ser parceladas."
            )
        if not payload.total_installments or payload.total_installments < 2:
            raise HTTPException(
                status_code=400, detail="Informe o número total de parcelas (mínimo 2)."
            )
        if cents(payload.adjusted_value if payload.adjusted_value is not None else payload.value) < payload.total_installments:
            raise HTTPException(422, "Cada parcela deve valer ao menos R$ 0,01.")


def _document(user_id: str, payload: TransactionIn) -> dict:
    total = quantize_brl(
        payload.adjusted_value if payload.adjusted_value else payload.value)
    doc: dict = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": payload.name.strip(),
        "value": total,
        "type": payload.type,
        "status": payload.status,
        "date": payload.date,
        "account_id": payload.account_id,
        "card_id": payload.card_id if payload.type == "despesa" else None,
        "to_account_id": (
            payload.to_account_id if payload.type == "transferencia" else None
        ),
        "category_id": payload.category_id,
        "fixed": payload.fixed,
        "recurrence": payload.recurrence or "mensal" if payload.fixed else None,
        "installment": payload.installment,
        "total_installments": (
            payload.total_installments if payload.installment else None
        ),
        "current_installment": (
            payload.current_installment or 1 if payload.installment else None
        ),
        "installment_value": (
            installment_portion({"value": total, "total_installments": payload.total_installments}, (payload.current_installment or 1) - 1)
            if payload.installment
            else None
        ),
        "adjusted_value": payload.adjusted_value,
        "attachment": payload.attachment,
        "notes": payload.notes,
        "notify_enabled": payload.notify_enabled,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    return doc


@router.get("", response_model=List[TransactionOut])
async def list_transactions(
    month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
    start_date: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}-\\d{2}$"),
    end_date: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}-\\d{2}$"),
    type: Optional[TxType] = Query(default=None),
    status: Optional[TxStatus] = Query(default=None),
    category_id: Optional[str] = Query(default=None),
    account_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None, max_length=80),
    user: dict = Depends(require_user),
) -> list[TransactionOut]:
    query: dict = {"user_id": user["id"]}
    if start_date or end_date:
        date_filter: dict = {}
        if start_date:
            date_filter["$gte"] = start_date
        if end_date:
            date_filter["$lte"] = end_date
        query["date"] = date_filter
    elif month:
        start, end = month_bounds(month)
        query["date"] = {"$gte": start, "$lte": end}
    if type:
        query["type"] = type
    if status:
        query["status"] = status
    if category_id:
        query["category_id"] = category_id
    if account_id:
        query["$or"] = [{"account_id": account_id}, {"to_account_id": account_id}]
    if search and search.strip():
        query["name"] = {"$regex": re.escape(search.strip()), "$options": "i"}
    docs = (
        await db.transactions.find(query)
        .sort([("date", -1), ("created_at", -1)])
        .to_list(2000)
    )
    accounts_by_id, categories_by_id = await _ref_maps(user["id"])
    cards_by_id = await _cards_by_id(user["id"])
    return [
        enrich_transaction(d, accounts_by_id, categories_by_id, cards_by_id)
        for d in docs
    ]


@router.get("/page")
async def list_transactions_page(
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    start_date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    type: Optional[TxType] = Query(default=None),
    status: Optional[TxStatus] = Query(default=None),
    category_id: Optional[str] = Query(default=None, max_length=1500),
    account_id: Optional[str] = Query(default=None, max_length=1500),
    search: Optional[str] = Query(default=None, max_length=80),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: Optional[str] = Query(default=None, max_length=1500),
    user: dict = Depends(require_user),
):
    """One bounded date-indexed scan; resume at the last examined document.

    Name searches, account OR and combined filters are applied on each bounded
    batch because they cannot safely rely on undocumented composite indexes.
    Empty matched pages can legitimately have next_cursor: clients continue
    until it becomes null, never calculating totals from partial pages.
    """
    from finnos.lib import db as store
    from finnos.lib.transaction_pages import (
        transaction_date_window, bounded_scan_size, decode_page,
    )
    from firebase_admin import firestore
    from starlette.concurrency import run_in_threadpool

    start, end = transaction_date_window(month, start_date, end_date)
    uid = store.scoped({"user_id": user["id"]})
    filters = dict(kind=type, status=status, category_id=category_id,
                   account_id=account_id, search=search.strip() if search else None)
    scan_size = bounded_scan_size(limit, any(filters.values()))
    direction = (firestore.Query.ASCENDING if sort_dir == "asc"
                 else firestore.Query.DESCENDING)

    def read_page():
        collection = store.root(store.client(), uid).collection("transactions")
        query = (
            collection.where("date", ">=", start)
            .where("date", "<=", end)
            .order_by("date", direction=direction)
        )
        if cursor:
            previous = collection.document(store.resource_id(cursor)).get()
            if not previous.exists:
                raise HTTPException(422, "Cursor financeiro expirado ou inválido.")
            previous_date = (previous.to_dict() or {}).get("date")
            if not isinstance(previous_date, str) or not start <= previous_date <= end:
                raise HTTPException(422, "Cursor não pertence ao período solicitado.")
            query = query.start_after(previous)
        snapshots = list(query.limit(scan_size).stream(timeout=15))
        selected, next_cursor = decode_page(
            snapshots, limit=limit, filters=filters, scan_size=scan_size,
        )
        docs = [
            dict(store.decode(snap.to_dict()), id=snap.id, user_id=uid)
            for snap in selected
        ]
        return docs, next_cursor

    docs, next_cursor = await run_in_threadpool(read_page)
    accounts_by_id, categories_by_id = await _ref_maps(uid)
    cards_by_id = await _cards_by_id(uid)
    return {
        "month": month or start[:7],
        "items": [
            enrich_transaction(doc, accounts_by_id, categories_by_id, cards_by_id)
            for doc in docs
        ],
        "next_cursor": next_cursor,
    }


@router.post("", response_model=TransactionOut, status_code=201)
async def create_transaction(
    payload: TransactionIn,
    user: dict = Depends(require_user),
    x_finnos_operation_id: Optional[str] = Header(default=None),
    x_finnos_source: Optional[str] = Header(default="manual"),
) -> TransactionOut:
    await _validate(user["id"], payload)
    doc = _document(user["id"], payload)
    doc["operation_id"] = x_finnos_operation_id
    if payload.fixed and not payload.installment:
        # The same offline operation always resolves to the same series.
        # The client cannot choose a foreign or colliding series ID.
        doc["recurrence_id"] = str(uuid.uuid5(
            uuid.NAMESPACE_URL,
            "finnos:series:" + user["id"] + ":" +
            (x_finnos_operation_id or doc["id"]),
        ))
    doc["source"] = normalized_operation_source(x_finnos_source)
    await db.transactions.insert_one(doc)
    accounts_by_id, categories_by_id = await _ref_maps(user["id"])
    return enrich_transaction(
        doc, accounts_by_id, categories_by_id, await _cards_by_id(user["id"])
    )


@router.put("/{tx_id}", response_model=TransactionOut)
async def update_transaction(
    tx_id: str,
    payload: TransactionIn,
    user: dict = Depends(require_user),
    x_finnos_operation_id: Optional[str] = Header(default=None),
    x_finnos_base_version: Optional[int] = Header(default=None),
    x_finnos_source: Optional[str] = Header(default="manual"),
) -> TransactionOut:
    existing = await db.transactions.find_one({"id": tx_id, "user_id": user["id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Transação não encontrada.")
    await _validate(user["id"], payload)
    doc = _document(user["id"], payload)
    doc["id"] = tx_id
    # Do not assign a new ID to an existing legacy fixed series: its old
    # rows still use the conservative composite key in projections.
    if existing.get("recurrence_id"):
        doc["recurrence_id"] = existing["recurrence_id"]
    elif payload.fixed and not existing.get("fixed"):
        doc["recurrence_id"] = str(uuid.uuid5(
            uuid.NAMESPACE_URL, "finnos:series:" + user["id"] + ":" + tx_id,
        ))
    doc["created_at"] = existing.get("created_at")
    doc["operation_id"] = x_finnos_operation_id
    doc["_expected_version"] = x_finnos_base_version
    doc["source"] = normalized_operation_source(x_finnos_source)
    await db.transactions.replace_one({"id": tx_id, "user_id": user["id"]}, doc)
    doc = await db.transactions.find_one({"id":tx_id,"user_id":user["id"]})
    accounts_by_id, categories_by_id = await _ref_maps(user["id"])
    return enrich_transaction(
        doc, accounts_by_id, categories_by_id, await _cards_by_id(user["id"])
    )


class RecurrenceChanges(FinanceModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    value: Money | None = Field(default=None, gt=0)


class RecurrenceScopedEdit(FinanceModel):
    scope: Literal["esta", "proximas", "todas"]
    effective_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    changes: RecurrenceChanges


@router.post("/{tx_id}/recurrence", response_model=TransactionOut)
async def change_recurrence_scope(
    tx_id: str,
    payload: RecurrenceScopedEdit,
    user: dict = Depends(require_user),
    x_finnos_operation_id: str = Header(min_length=8, max_length=80),
    x_finnos_base_version: int = Header(ge=1),
) -> TransactionOut:
    """Atomic scope edit: receipt, original and reference checks in one attempt.

    Never touches settled historical rows. Reused operation IDs must have an
    identical payload and cannot create two future occurrences.
    """
    uid = user["id"]
    changes = payload.changes.model_dump(exclude_unset=True)
    if not changes or any(value is None for value in changes.values()):
        raise HTTPException(422, "Informe nome e/ou valor válidos.")
    normalized = payload.model_dump(mode="json")
    digest = hashlib.sha256(json.dumps({
        "source": tx_id, "base_version": x_finnos_base_version,
        "scope": normalized["scope"], "effective_date": normalized["effective_date"],
        "changes": normalized["changes"],
    }, sort_keys=True).encode()).hexdigest()

    def write():
        firebase = store.client()
        parent = store.root(firebase, uid)
        source_ref = parent.collection("transactions").document(store.resource_id(tx_id))
        receipt_key = hashlib.sha256(
            ("transactions:recurrence:" + x_finnos_operation_id).encode()
        ).hexdigest()
        receipt_ref = parent.collection("sync_receipts").document(receipt_key)

        def action(tr):
            receipt = receipt_ref.get(transaction=tr)
            if receipt.exists:
                previous = receipt.to_dict() or {}
                if previous.get("fingerprint") != digest:
                    raise HTTPException(409, "Identificador de recorrência reutilizado.")
                return previous["target_id"]
            snap = source_ref.get(transaction=tr)
            if not snap.exists:
                raise HTTPException(404, "Série recorrente não encontrada.")
            source = dict(
                store.decode(snap.to_dict()), id=tx_id, user_id=uid
            )
            if source.get("version", 1) != x_finnos_base_version:
                raise HTTPException(409, "Série mudou desde a última consulta.")
            try:
                result = plan_recurrence_edit(
                    source, changes, scope=payload.scope,
                    effective_date=payload.effective_date,
                    operation_id=x_finnos_operation_id, uid=uid,
                    today=today_iso(),
                )
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc
            new_doc = result["after"]
            new_doc["updated_at"] = datetime.now(timezone.utc)
            target = source_ref
            if result["action"] == "create":
                # New projected occurrence is not a settled purchase; a fresh
                # timestamp and new ID keep its audit history independent.
                new_doc["created_at"] = datetime.now(timezone.utc)
                target = parent.collection("transactions").document(
                    store.resource_id(new_doc["id"])
                )
                if target.get(transaction=tr).exists:
                    raise HTTPException(409, "Ocorrência já registrada.")
            else:
                new_doc["version"] = source.get("version", 1) + 1
            store.validate_refs(
                firebase, uid, "transactions", new_doc, tr,
                original_tx=source if result["action"] == "replace" else None,
            )
            # No reads after this point in the Firestore transaction.
            if result["action"] == "create":
                tr.create(target, store.encode(new_doc))
            else:
                tr.set(target, store.encode(new_doc))
            record_event(
                tr, parent, "transactions",
                "created" if result["action"] == "create" else "updated",
                result["before"], new_doc,
            )
            tr.create(receipt_ref, {
                "fingerprint": digest, "target_id": new_doc["id"],
                "scope": payload.scope, "base_version": x_finnos_base_version,
            })
            return new_doc["id"]

        return store.atomic(firebase, uid, action)

    target_id = await run_in_threadpool(write)
    doc = await db.transactions.find_one({"id": target_id, "user_id": uid})
    if doc is None:
        raise HTTPException(409, "Ocorrência registrada, mas leitura indisponível.")
    accounts, categories = await _ref_maps(uid)
    return enrich_transaction(doc, accounts, categories, await _cards_by_id(uid))


@router.delete("/{tx_id}", status_code=204)
async def delete_transaction(
    tx_id: str,
    user: dict = Depends(require_user),
    x_finnos_operation_id: Optional[str] = Header(default=None),
    x_finnos_base_version: Optional[int] = Header(default=None),
) -> None:
    # SYNC-02: a lost DELETE response is safe to retry with the same
    # operation ID. A concurrent update must block an old offline deletion.
    # Without sync headers, preserve the original online API contract.
    query = {"id": tx_id, "user_id": user["id"]}
    if x_finnos_operation_id:
        query["_operation_id"] = x_finnos_operation_id
    if x_finnos_base_version is not None:
        query["_expected_version"] = x_finnos_base_version
    result = await db.transactions.delete_one(query)
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Transação não encontrada.")


@router.get("/{tx_id}", response_model=TransactionOut)
async def get_transaction(tx_id: str, user: dict = Depends(require_user)):
    doc = await db.transactions.find_one({"user_id": user["id"], "id": tx_id})
    if not doc:
        raise HTTPException(404, "Transação não encontrada.")
    accounts, categories = await _ref_maps(user["id"])
    return enrich_transaction(doc, accounts, categories, await _cards_by_id(user["id"]))
