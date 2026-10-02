"""Bank accounts with server-computed balances (money already due up to today)."""

import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response

from lib.db import db
from lib.dates import today_iso
from lib.stats import aware, balance_effects
from models.finnos import AccountDetailOut, AccountIn, AccountOut
from routers.auth import require_user
from routers.transactions import _ref_maps, enrich_transaction

router = APIRouter(prefix="/accounts", tags=["accounts"])


async def _enriched_accounts(user_id: str) -> list[AccountOut]:
    today = today_iso()
    accounts = await db.accounts.find({"user_id": user_id}).sort("created_at", 1).to_list(500)
    txs = await db.transactions.find({"user_id": user_id}).to_list(20000)

    balance = {a["id"]: float(a.get("initial_balance") or 0.0) for a in accounts}
    income = {a["id"]: 0.0 for a in accounts}
    expense = {a["id"]: 0.0 for a in accounts}
    for tx in txs:
        for acc_id, amount in balance_effects(tx, today):
            balance[acc_id] = balance.get(acc_id, 0.0) + amount
            if tx.get("type") == "receita":
                income[acc_id] += amount
            elif tx.get("type") == "despesa":
                expense[acc_id] -= amount

    out = []
    for a in accounts:
        out.append(
            AccountOut(
                id=a["id"],
                name=a["name"],
                institution=a.get("institution", ""),
                type=a.get("type", "corrente"),
                color=a.get("color", "#070F52"),
                initial_balance=float(a.get("initial_balance") or 0.0),
                active=a.get("active", True),
                balance=round(balance[a["id"]], 2),
                total_income=round(max(income[a["id"]], 0.0), 2),
                total_expense=round(max(expense[a["id"]], 0.0), 2),
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
async def get_account(account_id: str, user: dict = Depends(require_user)) -> AccountDetailOut:
    account = await _one_enriched(user["id"], account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    docs = (
        await db.transactions.find(
            {"user_id": user["id"], "$or": [{"account_id": account_id}, {"to_account_id": account_id}]}
        )
        .sort([("date", -1), ("created_at", -1)])
        .to_list(8)
    )
    accounts_by_id, categories_by_id = await _ref_maps(user["id"])
    transactions = [enrich_transaction(d, accounts_by_id, categories_by_id) for d in docs]
    return AccountDetailOut(account=account, transactions=transactions)


@router.post("", response_model=AccountOut, status_code=201)
async def create_account(payload: AccountIn, user: dict = Depends(require_user)) -> AccountOut:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        **payload.model_dump(),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.accounts.insert_one(doc)
    account = await _one_enriched(user["id"], doc["id"])
    if not account:
        raise HTTPException(status_code=500, detail="Falha ao criar a conta.")
    return account


@router.put("/{account_id}", response_model=AccountOut)
async def update_account(account_id: str, payload: AccountIn, user: dict = Depends(require_user)) -> AccountOut:
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
        {"user_id": user["id"], "$or": [{"account_id": account_id}, {"to_account_id": account_id}]}
    )
    if used:
        raise HTTPException(
            status_code=409,
            detail="Esta conta tem transações vinculadas. Exclua ou mova as transações antes de excluir a conta.",
        )
    result = await db.accounts.delete_one({"id": account_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
