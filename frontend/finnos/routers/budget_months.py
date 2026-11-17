"""Orçamento por mês: o plano revisado pela pessoa e o retrato do fechamento.

Só guarda o que é do Orçamento. Não lê nem grava lançamentos, saldos, metas ou assinaturas: aportes e transferências
continuam sendo confirmados nos próprios módulos. Cada mês é um documento (id = AAAA-MM) em
users/{uid}/budget_plans e users/{uid}/budget_closings, gravado de forma atômica com a revisão financeira, por isso
entra na cópia do aparelho (funciona sem internet) e no backup como os outros módulos.

Planos especiais (viagem, Natal, mudança…) ficam em users/{uid}/budget_specials: só datas, valor, limites por
categoria e a meta ligada. O dinheiro continua em Metas e os gastos continuam no Fluxo.
"""
import re
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field

from finnos.lib.db import db
from finnos.lib.money import FinanceModel, Money
from finnos.routers.auth import require_user

router = APIRouter(prefix="/budgets", tags=["budgets"])
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
KEY = Field(min_length=1, max_length=200)


class PlanReminder(FinanceModel):
    """Something the person asked to remember in the month (shown in the Orçamento on the day)."""
    id: str = Field(min_length=1, max_length=60)
    date: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")
    text: str = Field(min_length=1, max_length=140)
    kind: Literal["conta", "assinatura", "recebimento", "meta", "outro"] = "outro"
    done: bool = False


class BudgetPlanIn(FinanceModel):
    """What the person decided for a month: included and left-out items, savings per meta, planned totals."""
    approved: list[str] = Field(default_factory=list, max_length=500)
    ignored: list[str] = Field(default_factory=list, max_length=500)
    saving: dict[str, Money] = Field(default_factory=dict, max_length=100)
    planned_income: Money = Field(default=0, ge=0)
    planned_bills: Money = Field(default=0, ge=0)
    planned_saving: Money = Field(default=0, ge=0)
    planned_spend: Money = 0
    # Special plans the person included in this month: none enters on its own.
    specials: list[str] = Field(default_factory=list, max_length=40)
    reminders: list[PlanReminder] = Field(default_factory=list, max_length=60)
    # What each included record was expected to be when the month was planned ("tx:<id>" → value), so the closing
    # can say "recebi menos" or "paguei a mais" even after the record changed in Fluxo.
    expected: dict[str, Money] = Field(default_factory=dict, max_length=500)


class BudgetPlanOut(BudgetPlanIn):
    month: str
    updated_at: str | None = None


class ClosingAllocation(FinanceModel):
    id: str = Field(min_length=1, max_length=200)
    kind: Literal["meta", "conta"]
    name: str = Field(min_length=1, max_length=120)
    value: Money = Field(ge=0)


class ClosingCategory(FinanceModel):
    category_id: str = Field(min_length=1, max_length=200)
    name: str = Field(max_length=120)
    spent: Money
    limit: Money = Field(ge=0)


class ClosingEstimate(FinanceModel):
    """What was expected in the month and whether it happened by the closing (kept to learn which forecasts miss)."""
    name: str = Field(min_length=1, max_length=120)
    type: Literal["receita", "despesa"]
    value: Money = Field(ge=0)
    outcome: Literal["aconteceu", "aberto"]


class BudgetClosingIn(FinanceModel):
    closed_at: str = Field(min_length=10, max_length=40)
    earned: Money
    spent: Money
    result: Money
    daily_planned: Money = Field(ge=0)
    daily_spent: Money
    planned_income: Money | None = None
    planned_bills: Money | None = None
    allocation: list[ClosingAllocation] = Field(default_factory=list, max_length=50)
    categories: list[ClosingCategory] = Field(default_factory=list, max_length=200)
    # The person's own note about the month ("o aniversário da Ana pesou em Restaurantes").
    note: str | None = Field(default=None, max_length=500)
    estimates: list[ClosingEstimate] = Field(default_factory=list, max_length=300)


class BudgetClosingOut(BudgetClosingIn):
    month: str


def _clean(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in {"user_id", "id", "version", "operation_id", "created_at"}}


def _month(month: str) -> str:
    import re
    if not re.match(MONTH, month):
        raise HTTPException(422, "Mês inválido.")
    return month


async def _put(collection, uid: str, month: str, payload: dict) -> dict:
    """One document per month: created the first time, replaced after (idempotent, safe to replay offline)."""
    found = await collection.find_one({"id": month, "user_id": uid})
    if found:
        await collection.update_one({"id": month, "user_id": uid}, {"$set": payload})
    else:
        await collection.insert_one({**payload, "id": month, "user_id": uid, **({"month": month} if re.match(MONTH, month) else {})})
    return await collection.find_one({"id": month, "user_id": uid}) or {**payload, "id": month}


@router.get("/plans", response_model=list[BudgetPlanOut])
async def list_plans(user=Depends(require_user)):
    rows = await db.budget_plans.find({"user_id": user["id"]}).to_list(240)
    return [BudgetPlanOut(**{**_clean(r), "month": r.get("month") or r["id"]}) for r in rows]


@router.put("/plans/{month}", response_model=BudgetPlanOut)
async def put_plan(month: str, payload: BudgetPlanIn, user=Depends(require_user)):
    _month(month)
    saved = await _put(db.budget_plans, user["id"], month, {**payload.model_dump(), "month": month, "updated_at": datetime.now(timezone.utc).isoformat()})
    return BudgetPlanOut(**{**_clean(saved), "month": month})


@router.get("/closings", response_model=list[BudgetClosingOut])
async def list_closings(user=Depends(require_user)):
    rows = await db.budget_closings.find({"user_id": user["id"]}).to_list(240)
    return [BudgetClosingOut(**{**_clean(r), "month": r.get("month") or r["id"]}) for r in rows]


@router.put("/closings/{month}", response_model=BudgetClosingOut)
async def put_closing(month: str, payload: BudgetClosingIn, user=Depends(require_user)):
    _month(month)
    saved = await _put(db.budget_closings, user["id"], month, {**payload.model_dump(), "month": month})
    return BudgetClosingOut(**{**_clean(saved), "month": month})


@router.delete("/closings/{month}", status_code=204)
async def reopen_closing(month: str, user=Depends(require_user)) -> Response:
    """Reopening only removes the Orçamento's snapshot; nothing in Fluxo, Carteira or Metas changes."""
    _month(month)
    await db.budget_closings.delete_one({"id": month, "user_id": user["id"]})
    return Response(status_code=204)


SPECIAL_ID = r"^[a-z0-9][a-z0-9-]{0,59}$"
DATE = r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"


class SpecialCategory(FinanceModel):
    category_id: str = Field(min_length=1, max_length=200)
    name: str = Field(max_length=120)
    limit: Money = Field(ge=0)


class BudgetSpecialIn(FinanceModel):
    """A special plan: dates, how much, limits while it runs and where the money comes from (a meta or the 13º)."""
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["Viagem", "Férias", "Natal", "Mudança", "Evento", "Compra", "Renda menor", "Imprevisto"]
    start: str = Field(pattern=DATE)
    end: str = Field(pattern=DATE)
    amount: Money = Field(gt=0)
    source: Literal["nova", "existente", "13"]
    goal_id: str | None = Field(default=None, max_length=200)
    goal_name: str | None = Field(default=None, max_length=120)
    monthly: Money = Field(default=0, ge=0)
    categories: list[SpecialCategory] = Field(default_factory=list, max_length=40)
    created_at: str | None = Field(default=None, max_length=40)


class BudgetSpecialOut(BudgetSpecialIn):
    id: str


def _special_id(special_id: str) -> str:
    import re
    if not re.match(SPECIAL_ID, special_id):
        raise HTTPException(422, "Plano inválido.")
    return special_id


@router.get("/specials", response_model=list[BudgetSpecialOut])
async def list_specials(user=Depends(require_user)):
    rows = await db.budget_specials.find({"user_id": user["id"]}).to_list(100)
    return [BudgetSpecialOut(**{**_clean(r), "id": r["id"]}) for r in rows]


@router.put("/specials/{special_id}", response_model=BudgetSpecialOut)
async def put_special(special_id: str, payload: BudgetSpecialIn, user=Depends(require_user)):
    _special_id(special_id)
    if payload.end < payload.start:
        raise HTTPException(422, "A data final precisa ser depois da inicial.")
    saved = await _put(db.budget_specials, user["id"], special_id, payload.model_dump())
    return BudgetSpecialOut(**{**_clean(saved), "id": special_id})


@router.delete("/specials/{special_id}", status_code=204)
async def end_special(special_id: str, user=Depends(require_user)) -> Response:
    """Ending a plan removes only the plan: the meta and what is saved in it stay in Metas."""
    _special_id(special_id)
    await db.budget_specials.delete_one({"id": special_id, "user_id": user["id"]})
    return Response(status_code=204)
