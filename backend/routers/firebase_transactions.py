"""Isolated Firestore transaction API for migration validation.

Legacy /api/transactions stays on MongoDB. Firebase UID is derived solely from
a verified bearer token. No browser Firestore access is required.
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Query, Header, status
from starlette.concurrency import run_in_threadpool

from lib.firebase import get_firestore
from lib.firebase_auth import require_verified_firebase_user
from models.finnos import TransactionIn
from lib.firestore_refcheck import validate

router = APIRouter(prefix="/firebase/transactions", tags=["firebase-transactions"])

def _collection(uid: str):
    # UID comes from a verified Firebase token, never user-controlled input.
    return get_firestore().collection("users").document(uid).collection("transactions")

def _to_doc(payload: TransactionIn, tx_id: str) -> dict:
    data = payload.model_dump()
    # Canonical storage uses integer cents, not binary floating point.
    amount = Decimal(str(payload.value))
    cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents <= 0:
        raise HTTPException(status_code=422, detail="Valor deve ser maior que zero.")
    data.pop("value")
    data["value_cents"] = cents
    if payload.adjusted_value is not None:
        data["adjusted_value_cents"] = int(
            (Decimal(str(payload.adjusted_value)) * 100).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
        data.pop("adjusted_value")
    data["id"] = tx_id
    data["name"] = payload.name.strip()
    data["installment_value"] = (round(float(amount / payload.total_installments), 2) if payload.installment and payload.total_installments else None)
    data["current_installment"] = (payload.current_installment or 1) if payload.installment else None
    data["to_account_id"] = payload.to_account_id if payload.type == "transferencia" else None
    data["card_id"] = payload.card_id if payload.type == "despesa" else None
    return data

def _public(doc: dict) -> dict:
    result = dict(doc)
    result["value"] = float(Decimal(result.pop("value_cents")) / 100)
    if "adjusted_value_cents" in result:
        result["adjusted_value"] = float(Decimal(result.pop("adjusted_value_cents")) / 100)
    return result

@router.get("")
async def list_transactions(
    limit: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(require_verified_firebase_user),
):
    def read():
        snapshots = _collection(user["uid"]).limit(limit).stream()
        return [_public(s.to_dict()) for s in snapshots]
    return await run_in_threadpool(read)

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionIn,
    user: dict = Depends(require_verified_firebase_user),
    x_finnos_operation_id: str | None = Header(default=None),
):
    tx_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"finnos:{user['uid']}:{x_finnos_operation_id}")) if x_finnos_operation_id else str(uuid.uuid4())
    await run_in_threadpool(lambda: validate(user["uid"], payload))
    doc = _to_doc(payload, tx_id)
    now = datetime.now(timezone.utc)
    doc["created_at"] = now
    doc["updated_at"] = now
    if x_finnos_operation_id:
        doc["operation_id"] = x_finnos_operation_id
    def create_once():
        ref = _collection(user["uid"]).document(tx_id)
        try:
            ref.create(doc)
            return doc
        except Exception as exc:
            from google.api_core.exceptions import Conflict
            if not isinstance(exc, Conflict):
                raise
            existing = ref.get()
            if not existing.exists or existing.to_dict().get("operation_id") != x_finnos_operation_id:
                raise
            return existing.to_dict()
    return _public(await run_in_threadpool(create_once))

@router.get("/{tx_id}")
async def get_transaction(
    tx_id: uuid.UUID,
    user: dict = Depends(require_verified_firebase_user),
):
    snapshot = await run_in_threadpool(
        lambda: _collection(user["uid"]).document(str(tx_id)).get()
    )
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Transação não encontrada.")
    return _public(snapshot.to_dict())

@router.put("/{tx_id}")
async def update_transaction(
    tx_id: uuid.UUID,
    payload: TransactionIn,
    user: dict = Depends(require_verified_firebase_user),
):
    await run_in_threadpool(lambda: validate(user["uid"], payload))
    ref = _collection(user["uid"]).document(str(tx_id))
    def replace():
        snapshot = ref.get()
        if not snapshot.exists:
            return None
        doc = _to_doc(payload, str(tx_id))
        doc["created_at"] = snapshot.to_dict().get("created_at")
        doc["updated_at"] = datetime.now(timezone.utc)
        ref.set(doc)
        return _public(doc)
    result = await run_in_threadpool(replace)
    if result is None:
        raise HTTPException(status_code=404, detail="Transação não encontrada.")
    return result

@router.delete("/{tx_id}", status_code=204)
async def delete_transaction(
    tx_id: uuid.UUID,
    user: dict = Depends(require_verified_firebase_user),
):
    ref = _collection(user["uid"]).document(str(tx_id))
    def remove():
        snapshot = ref.get()
        if not snapshot.exists:
            return False
        ref.delete()
        return True
    if not await run_in_threadpool(remove):
        raise HTTPException(status_code=404, detail="Transação não encontrada.")
