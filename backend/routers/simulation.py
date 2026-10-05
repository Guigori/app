from datetime import date, timedelta
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from lib.db import db
from lib.dates import today_iso
from routers.auth import require_user
from routers.cards import _build as build_card, _context as card_context

router = APIRouter(prefix="/simulate", tags=["simulation"])

class PurchaseSimulationIn(BaseModel):
    amount: float = Field(gt=0)
    installments: int = Field(default=1, ge=1, le=48)
    card_id: str | None = None
    compare_installments: bool = True
    category_id: str | None = None

@router.post("/purchase")
async def simulate_purchase(payload: PurchaseSimulationIn, user: dict = Depends(require_user)):
    today = date.fromisoformat(today_iso())
    accounts = await db.accounts.find({"user_id": user["id"]}).to_list(500)
    txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)
    balance = sum(float(a.get("initial_balance") or 0) for a in accounts)
    for tx in txs:
        if tx.get("status") != "pago" or tx.get("date", "9999") > today.isoformat():
            continue
        value = float(tx.get("adjusted_value") or tx.get("value") or 0)
        if tx.get("type") == "receita": balance += value
        elif tx.get("type") == "despesa": balance -= value
    horizon = (today + timedelta(days=30)).isoformat()
    projected = balance
    for tx in txs:
        if tx.get("status") not in ("pendente", "agendado") or not (today.isoformat() <= tx.get("date", "") <= horizon):
            continue
        value = float(tx.get("adjusted_value") or tx.get("value") or 0)
        if tx.get("type") == "receita": projected += value
        elif tx.get("type") == "despesa": projected -= value
    installment_value = round(payload.amount / payload.installments, 2)
    cash_impact = payload.amount if payload.installments == 1 and not payload.card_id else installment_value
    card = None
    if payload.card_id:
        card_doc = await db.cards.find_one({"id": payload.card_id, "user_id": user["id"], "active": True})
        if card_doc:
            card_txs, account_map = await card_context(user["id"])
            current = await build_card(card_doc, card_txs, account_map)
            available = current.available
            card = {"id": current.id, "name": current.name, "available_before": available, "available_after": round(available - payload.amount, 2), "fits_limit": available >= payload.amount, "current_invoice_before": current.current_invoice, "current_invoice_after": round(current.current_invoice + installment_value, 2), "future_installments_before": current.future_installments, "future_installments_after": round(current.future_installments + max(payload.amount - installment_value, 0), 2)}
    budget = None
    cycle = await db.budget_cycles.find_one({"user_id": user["id"], "start_date": {"$lte": today.isoformat()}, "end_date": {"$gte": today.isoformat()}, "closed_at": None}, sort=[("start_date", -1)])
    if cycle and payload.category_id:
        allocation = next((a for a in cycle.get("allocations", []) if a.get("category_id") == payload.category_id), None)
        if allocation:
            start, end = str(cycle["start_date"]), str(cycle["end_date"])
            spent = committed = 0.0
            for tx in txs:
                if tx.get("type") != "despesa" or tx.get("category_id") != payload.category_id or not (start <= tx.get("date", "") <= end):
                    continue
                value = float(tx.get("installment_value") or tx.get("adjusted_value") or tx.get("value") or 0)
                if tx.get("status") == "pago": spent += value
                elif tx.get("status") in ("pendente", "agendado"): committed += value
            planned = float(allocation.get("planned") or 0)
            available = round(planned - spent - committed, 2)
            budget = {"category_id": payload.category_id, "planned": round(planned, 2), "spent": round(spent, 2), "committed": round(committed, 2), "available_before": available, "available_after": round(available - cash_impact, 2), "fits_budget": available >= cash_impact}
    after = round(projected - cash_impact, 2)
    level = "confortavel" if after >= payload.amount * .2 and (not card or card["fits_limit"]) and (not budget or budget["fits_budget"]) else "apertado" if after >= 0 and (not card or card["fits_limit"]) else "critico"
    scenarios = []
    if payload.compare_installments:
        for parts in (1, 3, 6, 12):
            per_month = round(payload.amount / parts, 2)
            scenario_after = round(projected - (payload.amount if parts == 1 and not payload.card_id else per_month), 2)
            scenarios.append({"installments": parts, "installment_value": per_month, "projected_30d_after": scenario_after, "card_limit_after": round(card["available_before"] - payload.amount, 2) if card else None})
    return {"amount": round(payload.amount, 2), "installments": payload.installments, "installment_value": installment_value, "balance_now": round(balance, 2), "projected_30d_before": round(projected, 2), "projected_30d_after": after, "cash_impact_30d": round(cash_impact, 2), "card": card, "budget": budget, "level": level, "scenarios": scenarios, "writes_data": False}
