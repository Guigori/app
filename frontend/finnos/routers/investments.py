"""UID-scoped investment positions, entered by the user (no broker integration).

A position is what was applied and what it is worth now; nothing here moves money
or touches account balances. The Patrimônio screen sums the current values.
"""
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field

from finnos.lib.db import db
from finnos.lib.money import FinanceModel, Money
from finnos.routers.auth import require_user

router = APIRouter(prefix="/investments", tags=["investments"])

Kind = Literal["renda_fixa", "tesouro", "acoes", "fundos", "fii", "cripto", "previdencia", "outro"]


class InvestmentIn(FinanceModel):
    name: str = Field(min_length=1, max_length=100)
    kind: Kind
    invested: Money = Field(ge=0)
    current: Money = Field(ge=0)
    updated_on: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    account: str | None = None
    notes: str | None = Field(default=None, max_length=300)


class InvestmentOut(InvestmentIn):
    id: str
    created_at: str


def _out(record: dict) -> InvestmentOut:
    return InvestmentOut(**{k: v for k, v in record.items() if k not in {"user_id", "updated_at", "version"}})


@router.get("", response_model=list[InvestmentOut])
async def list_investments(user=Depends(require_user)):
    return [_out(row) for row in await db.investments.find({"user_id": user["id"]}).to_list(500)]


@router.post("", response_model=InvestmentOut, status_code=201)
async def create_investment(payload: InvestmentIn, user=Depends(require_user)):
    doc = dict(payload.model_dump(), id=str(uuid.uuid4()), user_id=user["id"], created_at=datetime.now(timezone.utc).isoformat())
    await db.investments.insert_one(doc)
    return _out(doc)


@router.put("/{investment_id}", response_model=InvestmentOut)
async def update_investment(investment_id: str, payload: InvestmentIn, user=Depends(require_user)):
    result = await db.investments.update_one(
        {"id": investment_id, "user_id": user["id"]},
        {"$set": {**payload.model_dump(), "updated_at": datetime.now(timezone.utc)}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Investimento não encontrado.")
    updated = await db.investments.find_one({"id": investment_id, "user_id": user["id"]})
    if not updated:
        raise HTTPException(409, "O investimento mudou durante a edição.")
    return _out(updated)


@router.delete("/{investment_id}", status_code=204)
async def delete_investment(investment_id: str, user=Depends(require_user)) -> Response:
    result = await db.investments.delete_one({"id": investment_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Investimento não encontrado.")
    return Response(status_code=204)
