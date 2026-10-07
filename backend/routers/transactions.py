"""Transactions CRUD — filters, installment math and server-side enrichment."""

import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response

from lib.db import db
from lib.stats import aware, month_bounds
from models.finnos import TransactionIn, TransactionOut, TxStatus, TxType
from routers.auth import require_user

router = APIRouter(prefix="/transactions", tags=["transactions"])


async def _ref_maps(user_id: str) -> tuple[dict, dict]:
    accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
    categories = await db.categories.find({"user_id": user_id}).to_list(500)
    return {a["id"]: a for a in accounts}, {c["id"]: c for c in categories}


async def _cards_by_id(user_id: str) -> dict:
    cards = await db.cards.find({"user_id": user_id}).to_list(200)
    return {c["id"]: c for c in cards}


def enrich_transaction(
    doc: dict, accounts_by_id: dict, categories_by_id: dict, cards_by_id: dict | None = None
) -> TransactionOut:
    account = accounts_by_id.get(doc["account_id"], {})
    to_account = accounts_by_id.get(doc.get("to_account_id") or "", {})
    category = categories_by_id.get(doc.get("category_id") or "", {})
    return TransactionOut(
        id=doc["id"],
        name=doc["name"],
        value=float(doc["value"]),
        type=doc["type"],
        status=doc.get("status", "pago"),
        date=doc["date"],
        account_id=doc["account_id"],
        account_name=account.get("name", ""),
        card_id=doc.get("card_id"),
        card_name=(cards_by_id or {}).get(doc.get("card_id") or "", {}).get("name") or None,
        to_account_id=doc.get("to_account_id"),
        to_account_name=to_account.get("name") or None,
        category_id=doc.get("category_id"),
        category_name=category.get("name") or None,
        category_color=category.get("color") or None,
        category_icon=category.get("icon") or None,
        fixed=doc.get("fixed", False),
        recurrence=doc.get("recurrence"),
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
    if payload.account_id not in accounts_by_id:
        raise HTTPException(status_code=400, detail="Conta inválida: selecione uma conta cadastrada.")
    if payload.type == "transferencia":
        if not payload.to_account_id or payload.to_account_id == payload.account_id:
            raise HTTPException(status_code=400, detail="Escolha contas diferentes para a transferência.")
        if payload.to_account_id not in accounts_by_id:
            raise HTTPException(status_code=400, detail="Conta de destino inválida.")
    if payload.category_id and payload.category_id not in categories_by_id:
        raise HTTPException(status_code=400, detail="Categoria inválida.")
    if payload.card_id:
        card = await db.cards.find_one({"id": payload.card_id, "user_id": user_id})
        if not card:
            raise HTTPException(status_code=400, detail="Cartão inválido: selecione um cartão cadastrado.")
    if payload.installment:
        if payload.type != "despesa":
            raise HTTPException(status_code=400, detail="Somente despesas podem ser parceladas.")
        if not payload.total_installments or payload.total_installments < 2:
            raise HTTPException(status_code=400, detail="Informe o número total de parcelas (mínimo 2).")


def _document(user_id: str, payload: TransactionIn) -> dict:
    total = round(payload.adjusted_value if payload.adjusted_value else payload.value, 2)
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
        "to_account_id": payload.to_account_id if payload.type == "transferencia" else None,
        "category_id": payload.category_id,
        "fixed": payload.fixed,
        "recurrence": (payload.recurrence or "mensal") if payload.fixed else None,
        "installment": payload.installment,
        "total_installments": payload.total_installments if payload.installment else None,
        "current_installment": (payload.current_installment or 1) if payload.installment else None,
        "installment_value": round(total / payload.total_installments, 2) if payload.installment else None,
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
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    start_date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
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
    return [enrich_transaction(d, accounts_by_id, categories_by_id, cards_by_id) for d in docs]


@router.post("", response_model=TransactionOut, status_code=201)
async def create_transaction(
    payload: TransactionIn,
    user: dict = Depends(require_user),
    x_finnos_operation_id: Optional[str] = Header(default=None),
    x_finnos_source: Optional[str] = Header(default="manual"),
) -> TransactionOut:
    if x_finnos_operation_id:
        existing = await db.transactions.find_one({"user_id": user["id"], "operation_id": x_finnos_operation_id})
        if existing:
            accounts_by_id, categories_by_id = await _ref_maps(user["id"])
            return enrich_transaction(existing, accounts_by_id, categories_by_id, await _cards_by_id(user["id"]))
    await _validate(user["id"], payload)
    doc = _document(user["id"], payload)
    doc["operation_id"] = x_finnos_operation_id
    doc["source"] = x_finnos_source or "manual"
    await db.transactions.insert_one(doc)
    accounts_by_id, categories_by_id = await _ref_maps(user["id"])
    return enrich_transaction(doc, accounts_by_id, categories_by_id, await _cards_by_id(user["id"]))


@router.put("/{tx_id}", response_model=TransactionOut)
async def update_transaction(
    tx_id: str,
    payload: TransactionIn,
    user: dict = Depends(require_user),
    x_finnos_operation_id: Optional[str] = Header(default=None),
    x_finnos_source: Optional[str] = Header(default="manual"),
) -> TransactionOut:
    if x_finnos_operation_id:
        replay = await db.transactions.find_one({"id": tx_id, "user_id": user["id"], "operation_id": x_finnos_operation_id})
        if replay:
            accounts_by_id, categories_by_id = await _ref_maps(user["id"])
            return enrich_transaction(replay, accounts_by_id, categories_by_id, await _cards_by_id(user["id"]))
    await _validate(user["id"], payload)
    existing = await db.transactions.find_one({"id": tx_id, "user_id": user["id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Transação não encontrada.")
    doc = _document(user["id"], payload)
    doc["id"] = tx_id  # the id is stable across edits — regenerating it orphans the record
    doc["created_at"] = existing.get("created_at")
    doc["operation_id"] = x_finnos_operation_id
    doc["source"] = x_finnos_source or "manual"
    await db.transactions.replace_one({"_id": existing["_id"]}, doc)
    accounts_by_id, categories_by_id = await _ref_maps(user["id"])
    return enrich_transaction(doc, accounts_by_id, categories_by_id, await _cards_by_id(user["id"]))


@router.delete("/{tx_id}", status_code=204)
async def delete_transaction(tx_id: str, user: dict = Depends(require_user)) -> None:
    result = await db.transactions.delete_one({"id": tx_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Transação não encontrada.")
