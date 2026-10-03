"""Budget V2 — versioned cycles. Existing monthly category budgets remain untouched."""

import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.db import db
from models.budget import BudgetAllocationOut, BudgetCycleIn, BudgetCycleOut
from routers.auth import require_user

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _status(cycle: dict, today: date) -> str:
    start = date.fromisoformat(str(cycle["start_date"]))
    end = date.fromisoformat(str(cycle["end_date"]))
    if cycle.get("closed_at") or end < today:
        return "fechado"
    if start > today:
        return "programado"
    return "ativo"


async def _out(cycle: dict) -> BudgetCycleOut:
    category_ids = [a["category_id"] for a in cycle.get("allocations", [])]
    categories = await db.categories.find({"id": {"$in": category_ids}}).to_list(500) if category_ids else []
    by_id = {c["id"]: c for c in categories}
    allocations = [
        BudgetAllocationOut(
            **allocation,
            name=by_id.get(allocation["category_id"], {}).get("name"),
            icon=by_id.get(allocation["category_id"], {}).get("icon"),
            color=by_id.get(allocation["category_id"], {}).get("color"),
        )
        for allocation in cycle.get("allocations", [])
    ]
    payload = {k: v for k, v in cycle.items() if k not in {"_id", "user_id", "allocations", "status"}}
    return BudgetCycleOut(**payload, allocations=allocations, status=_status(cycle, date.today()))


@router.get("", response_model=List[BudgetCycleOut])
async def list_cycles(
    status: Optional[str] = Query(default=None, pattern="^(programado|ativo|fechado)$"),
    user: dict = Depends(require_user),
) -> List[BudgetCycleOut]:
    cycles = await db.budget_cycles.find({"user_id": user["id"]}).sort("start_date", -1).to_list(500)
    output = [await _out(c) for c in cycles]
    return [c for c in output if c.status == status] if status else output


@router.get("/current", response_model=Optional[BudgetCycleOut])
async def current_cycle(user: dict = Depends(require_user)):
    today = date.today().isoformat()
    cycle = await db.budget_cycles.find_one(
        {"user_id": user["id"], "start_date": {"$lte": today}, "end_date": {"$gte": today}, "closed_at": None},
        sort=[("start_date", -1)],
    )
    return await _out(cycle) if cycle else None


@router.get("/next", response_model=Optional[BudgetCycleOut])
async def next_cycle(user: dict = Depends(require_user)):
    today = date.today().isoformat()
    cycle = await db.budget_cycles.find_one(
        {"user_id": user["id"], "start_date": {"$gt": today}, "closed_at": None},
        sort=[("start_date", 1)],
    )
    return await _out(cycle) if cycle else None


@router.post("", response_model=BudgetCycleOut, status_code=201)
async def create_cycle(input: BudgetCycleIn, user: dict = Depends(require_user)) -> BudgetCycleOut:
    start, end = input.start_date.isoformat(), input.end_date.isoformat()
    overlap = await db.budget_cycles.find_one({
        "user_id": user["id"],
        "closed_at": None,
        "start_date": {"$lte": end},
        "end_date": {"$gte": start},
    })
    if overlap:
        raise HTTPException(status_code=409, detail="Já existe um orçamento nesse período.")

    now = datetime.now(timezone.utc).isoformat()
    doc = input.model_dump(mode="json")
    doc.update({"id": str(uuid.uuid4()), "user_id": user["id"], "created_at": now, "closed_at": None})
    await db.budget_cycles.insert_one(doc)
    return await _out(doc)


@router.put("/{cycle_id}", response_model=BudgetCycleOut)
async def update_cycle(cycle_id: str, input: BudgetCycleIn, user: dict = Depends(require_user)) -> BudgetCycleOut:
    current = await db.budget_cycles.find_one({"id": cycle_id, "user_id": user["id"]})
    if not current:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    if _status(current, date.today()) == "fechado":
        raise HTTPException(status_code=409, detail="O histórico de um orçamento fechado não pode ser alterado.")

    start, end = input.start_date.isoformat(), input.end_date.isoformat()
    overlap = await db.budget_cycles.find_one({
        "user_id": user["id"],
        "id": {"$ne": cycle_id},
        "closed_at": None,
        "start_date": {"$lte": end},
        "end_date": {"$gte": start},
    })
    if overlap:
        raise HTTPException(status_code=409, detail="Já existe outro orçamento nesse período.")

    patch = input.model_dump(mode="json")
    await db.budget_cycles.update_one({"id": cycle_id, "user_id": user["id"]}, {"$set": patch})
    updated = {**current, **patch}
    return await _out(updated)
