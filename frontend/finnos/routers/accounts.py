from finnos.lib.money import D, quantize_brl

"""Bank accounts with server-computed balances (money already due up to today)."""
import uuid
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response, Header
from finnos.lib.db import db
from finnos.lib.dates import today_iso
from finnos.lib.stats import aware
from finnos.lib.account_balances import finance_revision, stream_account_balances
from finnos.models.finnos import AccountDetailOut, AccountIn, AccountOut
from finnos.routers.auth import require_user
from finnos.routers.transactions import _ref_maps, enrich_transaction

router = APIRouter(prefix="/accounts", tags=["accounts"])


async def _enriched_accounts(user_id: str) -> list[AccountOut]:
    today = today_iso()
    # Capture revision before reading opening balances; a concurrent write
    # must not produce an apparently valid but inconsistent account total.
    revision = await finance_revision(user_id)
    accounts = (
        await db.accounts.find({"user_id": user_id}).sort("created_at", 1).to_list(500)
    )
    ledger = await stream_account_balances(user_id, accounts, today, revision)
    out = []
    for a in accounts:
        balance, total_income, total_expense = ledger.result(a["id"])
        out.append(
            AccountOut(
                id=a["id"],
                name=a["name"],
                institution=a.get("institution", ""),
                institution_id=a.get("institution_id"),
                type=a.get("type", "corrente"),
                color=a.get("color", "#070F52"),
                initial_balance=D(a.get("initial_balance") or D("0.0")),
                active=a.get("active", True),
                balance=balance,
                total_income=total_income,
                total_expense=total_expense,
                created_at=aware(a.get("created_at")) or datetime.now(timezone.utc),
            )
        )
    return out


async def _one_enriched(user_id: str, account_id: str) -> AccountOut | None:
    for account in await _enriched_accounts(user_id):
        if account.id == account_id:
            return account
    return None


@router.get("", response_model=List[AccountOut])
async def list_accounts(user: dict = Depends(require_user)) -> list[AccountOut]:
    return await _enriched_accounts(user["id"])


@router.get("/{account_id}", response_model=AccountDetailOut)
async def get_account(
    account_id: str, user: dict = Depends(require_user)
) -> AccountDetailOut:
    account = await _one_enriched(user["id"], account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    docs = (
        await db.transactions.find(
            {
                "user_id": user["id"],
                "$or": [{"account_id": account_id}, {"to_account_id": account_id}],
            }
        )
        .sort([("date", -1), ("created_at", -1)])
        .to_list(8, allow_truncate=True)
    )
    accounts_by_id, categories_by_id = await _ref_maps(user["id"])
    transactions = [
        enrich_transaction(d, accounts_by_id, categories_by_id) for d in docs
    ]
    return AccountDetailOut(account=account, transactions=transactions)


@router.post("", response_model=AccountOut, status_code=201)
async def create_account(
    payload: AccountIn, user: dict = Depends(require_user),
    x_finnos_operation_id: str | None = Header(default=None, min_length=1, max_length=80)
) -> AccountOut:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        **payload.model_dump(),
        **({"operation_id": x_finnos_operation_id} if x_finnos_operation_id else {}),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.accounts.insert_one(doc)
    account = await _one_enriched(user["id"], doc["id"])
    if not account:
        raise HTTPException(status_code=500, detail="Falha ao criar a conta.")
    return account


@router.put("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: str, payload: AccountIn, user: dict = Depends(require_user)
) -> AccountOut:
    result = await db.accounts.update_one(
        {"id": account_id, "user_id": user["id"]},
        {"$set": {**payload.model_dump(), "updated_at": datetime.now(timezone.utc)}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    account = await _one_enriched(user["id"], account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    return account


@router.delete("/{account_id}", status_code=204)
async def delete_account(account_id: str, user: dict = Depends(require_user)) -> None:
    used = await db.transactions.count_documents(
        {
            "user_id": user["id"],
            "$or": [{"account_id": account_id}, {"to_account_id": account_id}],
        }
    )
    if used:
        raise HTTPException(
            status_code=409,
            detail="Esta conta tem transações vinculadas. Exclua ou mova as transações antes de excluir a conta.",
        )
    result = await db.accounts.delete_one({"id": account_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")


# Payment methods are read and written only through the verified FastAPI session.
# Existing users/{uid}/accountPaymentMethods/{accountId} documents are reused.
from typing import Literal
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool
from finnos.lib import db as store

PaymentMethod = Literal["Pix", "Débito", "Dinheiro", "Boleto"]

class PaymentMethodsPayload(BaseModel):
    methods: list[PaymentMethod] = Field(max_length=4)

    @field_validator("methods")
    @classmethod
    def unique_methods(cls, methods):
        if len(methods) != len(set(methods)):
            raise ValueError("Formas de pagamento duplicadas.")
        return methods

def _default_methods(account):
    return ["Dinheiro"] if account.get("type") == "carteira" else ["Pix", "Débito", "Boleto"]

@router.get("/{account_id}/payment-methods")
async def read_payment_methods(account_id: str, user: dict = Depends(require_user)):
    account = await db.accounts.find_one({"id": account_id, "user_id": user["id"]})
    if not account:
        raise HTTPException(404, "Conta não encontrada.")
    def read():
        ref = store.root(store.client(), user["id"]).collection("accountPaymentMethods").document(store.resource_id(account_id))
        snapshot = ref.get()
        saved = (snapshot.to_dict() or {}) if snapshot.exists else {}
        values = saved.get("methods", _default_methods(account))
        return {"methods": [m for m in ("Pix", "Débito", "Dinheiro", "Boleto") if isinstance(values, list) and m in values]}
    return await run_in_threadpool(read)

@router.put("/{account_id}/payment-methods")
async def change_payment_methods(
    account_id: str, payload: PaymentMethodsPayload, user: dict = Depends(require_user),
):
    uid = user["id"]
    def write():
        client = store.client()
        def action(tr):
            parent = store.root(client, uid)
            account = parent.collection("accounts").document(store.resource_id(account_id))
            if not account.get(transaction=tr).exists:
                raise HTTPException(404, "Conta não encontrada.")
            ref = parent.collection("accountPaymentMethods").document(store.resource_id(account_id))
            tr.set(ref, {"methods": payload.methods, "updatedAt": datetime.now(timezone.utc).isoformat()})
            return {"methods": payload.methods}
        return store.atomic(client, uid, action)
    return await run_in_threadpool(write)
