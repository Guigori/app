"""Firestore-only account dashboard; no legacy data fallback."""
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, Query
from starlette.concurrency import run_in_threadpool
from lib.firebase import get_firestore
from lib.firebase_auth import require_verified_firebase_user

router = APIRouter(prefix="/firebase/dashboard", tags=["firebase-dashboard"])

@router.get("")
async def dashboard(month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"), user: dict = Depends(require_verified_firebase_user)):
    uid = user["uid"]
    def read():
        root = get_firestore().collection("users").document(uid)
        return ([s.to_dict() or {} for s in root.collection("transactions").stream()],
                [s.to_dict() or {} for s in root.collection("accounts").stream()])
    txs, accounts = await run_in_threadpool(read)
    income = expense = Decimal(0)
    balance = sum((Decimal(str(a.get("initial_balance_cents", 0))) / 100 for a in accounts), Decimal(0))
    month = month or datetime.now(timezone.utc).strftime("%Y-%m")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for tx in txs:
        if tx.get("status") != "pago":
            continue
        value = Decimal(str(tx.get("value_cents", 0))) / 100
        typ = tx.get("type")
        date = str(tx.get("date", ""))
        if date <= today:
            balance += value if typ == "receita" else (-value if typ == "despesa" else 0)
        if date[:7] == month:
            if typ == "receita":
                income += value
            if typ == "despesa":
                expense += value
    return {"month": month, "total_balance": float(balance), "income": float(income),
            "expense": float(expense), "month_balance": float(income-expense),
            "prev_income": None, "prev_expense": None, "invested": 0,
            "categories": [], "rule": [], "recent": []}
