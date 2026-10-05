from datetime import date, timedelta
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from lib.db import db
from lib.dates import today_iso
from routers.auth import require_user

router = APIRouter(prefix="/simulate", tags=["simulation"])

class PurchaseSimulationIn(BaseModel):
    amount: float = Field(gt=0)
    installments: int = Field(default=1, ge=1, le=48)
    card_id: str | None = None

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
            limit_value = float(card_doc.get("limit") or 0)
            card_txs = [t for t in txs if t.get("card_id") == payload.card_id and t.get("type") == "despesa"]
            used = sum(float(t.get("installment_value") or t.get("value") or 0) for t in card_txs)
            available = max(limit_value - used, 0)
            card = {"id": payload.card_id, "name": card_doc.get("name"), "available_before": round(available, 2), "available_after": round(available - payload.amount, 2), "fits_limit": available >= payload.amount}
    after = round(projected - cash_impact, 2)
    level = "confortavel" if after >= payload.amount * .2 and (not card or card["fits_limit"]) else "apertado" if after >= 0 and (not card or card["fits_limit"]) else "critico"
    return {"amount": round(payload.amount, 2), "installments": payload.installments, "installment_value": installment_value, "balance_now": round(balance, 2), "projected_30d_before": round(projected, 2), "projected_30d_after": after, "cash_impact_30d": round(cash_impact, 2), "card": card, "level": level, "writes_data": False}
