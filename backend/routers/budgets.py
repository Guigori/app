"""Budget V2 — versioned cycles. Existing monthly category budgets remain untouched."""

import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.db import db
from models.budget import BudgetAllocationOut, BudgetAllocationProgress, BudgetCycleIn, BudgetCycleOut, BudgetCycleProgress
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


def _tx_amount(tx: dict) -> float:
    return round(float(tx.get("installment_value") or 0), 2) if tx.get("installment") else round(float(tx.get("value") or 0), 2)


def _occurrences_in_cycle(tx: dict, start: date, end: date):
    if tx.get("type") == "transferencia":
        return []
    import calendar
    tx_date = date.fromisoformat(tx["date"])
    amount, realised = _tx_amount(tx), tx.get("status") == "pago"
    out = []
    if tx.get("installment"):
        total = int(tx.get("total_installments") or 1)
        for offset in range(total):
            idx = tx_date.year * 12 + tx_date.month - 1 + offset
            yy, mm = idx // 12, idx % 12 + 1
            occurrence = date(yy, mm, min(tx_date.day, calendar.monthrange(yy, mm)[1]))
            if start <= occurrence <= end:
                out.append((occurrence, amount, realised and occurrence <= date.today()))
        return out
    if start <= tx_date <= end:
        out.append((tx_date, amount, realised))
    if tx.get("fixed") and (tx.get("recurrence") or "mensal") == "mensal":
        for offset in range(1, 60):
            idx = tx_date.year * 12 + tx_date.month - 1 + offset
            yy, mm = idx // 12, idx % 12 + 1
            occurrence = date(yy, mm, min(tx_date.day, calendar.monthrange(yy, mm)[1]))
            if occurrence > end:
                break
            if occurrence >= start:
                out.append((occurrence, amount, False))
    return out


async def _progress(cycle: dict, user_id: str) -> BudgetCycleProgress:
    start, end, today = date.fromisoformat(str(cycle["start_date"])), date.fromisoformat(str(cycle["end_date"])), date.today()
    txs = await db.transactions.find({"user_id": user_id}).to_list(20000)
    categories = await db.categories.find({"user_id": user_id}).to_list(500)
    by_id = {cat["id"]: cat for cat in categories}
    spent_by_cat, committed_by_cat = {}, {}
    received_income = committed_income = 0.0
    for tx in txs:
        for occurrence, amount, realised in _occurrences_in_cycle(tx, start, end):
            if tx.get("type") == "receita":
                if realised: received_income += amount
                else: committed_income += amount
            elif tx.get("type") == "despesa" and tx.get("category_id"):
                target = spent_by_cat if realised else committed_by_cat
                key = tx["category_id"]
                target[key] = target.get(key, 0) + amount
    allocations = []
    for allocation in cycle.get("allocations", []):
        key, planned = allocation["category_id"], round(float(allocation.get("planned") or 0), 2)
        spent, committed = round(spent_by_cat.get(key, 0), 2), round(committed_by_cat.get(key, 0), 2)
        projected, cat = round(spent + committed, 2), by_id.get(key, {})
        allocations.append(BudgetAllocationProgress(**allocation, name=cat.get("name"), icon=cat.get("icon"), color=cat.get("color"), spent=spent, committed=committed, available=round(planned-projected, 2), projected_close=projected, percent=round(projected/planned*100, 1) if planned else 0))
    planned, spent, committed = round(sum(a.planned for a in allocations),2), round(sum(a.spent for a in allocations),2), round(sum(a.committed for a in allocations),2)
    projected = round(spent + committed, 2)
    duration = max((end-start).days+1, 1)
    elapsed = 0 if today < start else duration if today > end else (today-start).days+1
    elapsed_percent, used_percent = round(elapsed/duration*100,1), round(projected/planned*100,1) if planned else 0
    pace = "sem_plano" if not planned else "acima" if used_percent > elapsed_percent+10 else "abaixo" if used_percent < max(elapsed_percent-10,0) else "no_ritmo"
    expected_income = round(float(cycle.get("expected_income") or 0),2)
    income_base = max(expected_income, round(received_income+committed_income,2))
    return BudgetCycleProgress(cycle_id=cycle["id"], start_date=start, end_date=end, planned=planned, spent=spent, committed=committed, available=round(planned-projected,2), projected_close=projected, expected_income=expected_income, received_income=round(received_income,2), committed_income=round(committed_income,2), safe_to_spend=round(max(income_base-spent-committed,0),2), elapsed_percent=elapsed_percent, used_percent=used_percent, pace=pace, allocations=allocations)


@router.get("/suggestion")
async def budget_suggestion(user: dict = Depends(require_user)):
    """Suggest category limits from recent behaviour; never writes a budget."""
    today = date.today()
    start_idx = today.year * 12 + today.month - 1 - 3
    sy, sm = start_idx // 12, start_idx % 12 + 1
    start = date(sy, sm, 1).isoformat()
    txs = await db.transactions.find({"user_id": user["id"], "type": "despesa", "status": "pago", "date": {"$gte": start}}).to_list(20000)
    cats = await db.categories.find({"user_id": user["id"]}).to_list(500)
    by_id = {c["id"]: c for c in cats}
    monthly: dict[tuple[str, str], float] = {}
    for tx in txs:
        cid = tx.get("category_id")
        if not cid: continue
        key = (cid, str(tx["date"])[:7])
        monthly[key] = monthly.get(key, 0) + _tx_amount(tx)
    suggestions = []
    for cid, cat in by_id.items():
        vals = [value for (key_cid, _), value in monthly.items() if key_cid == cid]
        if not vals: continue
        avg = round(sum(vals) / len(vals), 2)
        buffer = 1.05 if cat.get("group") == "necessidades" else 1.0
        planned = round(avg * buffer, 2)
        suggestions.append({"category_id": cid, "name": cat.get("name"), "group": cat.get("group"), "average": avg, "suggested": planned, "months_observed": len(vals)})
    suggestions.sort(key=lambda x: -x["suggested"])
    income_txs = await db.transactions.find({"user_id": user["id"], "type": "receita", "status": "pago", "date": {"$gte": start}}).to_list(5000)
    income_by_month: dict[str, float] = {}
    for tx in income_txs:
        key = str(tx["date"])[:7]; income_by_month[key] = income_by_month.get(key, 0) + _tx_amount(tx)
    expected_income = round(sum(income_by_month.values()) / len(income_by_month), 2) if income_by_month else 0
    return {"expected_income": expected_income, "categories": suggestions, "method": "media_recente", "writes_data": False}


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


@router.get("/{cycle_id}/progress", response_model=BudgetCycleProgress)
async def cycle_progress(cycle_id: str, user: dict = Depends(require_user)) -> BudgetCycleProgress:
    cycle = await db.budget_cycles.find_one({"id": cycle_id, "user_id": user["id"]})
    if not cycle:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    return await _progress(cycle, user["id"])


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
