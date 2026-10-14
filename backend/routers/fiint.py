"""Canonical FIINT endpoints. FAC remains available for legacy consumers.

All reads pass through the existing authenticated, user-scoped FAC data adapter.
No new database or unverified learning model is introduced.
"""
from datetime import date
from pydantic import BaseModel, Field
from lib.db import db
from lib.fiint.registration import interpret
from lib.fiint.memory import merchant_key, learned_category
from fastapi import APIRouter, Depends, HTTPException, Query
from lib.fac.clock import financial_today
from models.fac import FACAnalysis
from routers.auth import require_user
from routers.fac import _build

router = APIRouter(prefix="/fiint", tags=["fiint"])


@router.get("/analyses")
async def analyses(
    limit: int = Query(default=7, ge=1, le=7),
    user: dict = Depends(require_user),
):
    as_of = financial_today()
    rows = await _build(user["id"], as_of, limit)
    items = [FACAnalysis(**row) for row in rows]
    return {
        "engine": "FIINT",
        "version": "1.0",
        "as_of": as_of.isoformat(),
        "analyses": [item.model_dump(mode="json") for item in items],
        "count": len(items),
    }


@router.get("/analyses/{analysis_id}", response_model=FACAnalysis)
async def analysis_detail(
    analysis_id: str,
    user: dict = Depends(require_user),
):
    as_of: date = financial_today()
    rows = await _build(user["id"], as_of, None)
    row = next((item for item in rows if item["analysis_id"] == analysis_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Análise FIINT não encontrada.")
    return FACAnalysis(**row)


class RegistrationPreviewIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


@router.post("/registration/preview")
async def registration_preview(
    payload: RegistrationPreviewIn,
    user: dict = Depends(require_user),
):
    """Draft only: no database writes, no transaction creation."""
    accounts = await db.accounts.find({"user_id": user["id"]}).to_list(500)
    categories = await db.categories.find({"user_id": user["id"]}).to_list(500)
    try:
        draft = interpret(
            payload.text, today=financial_today(),
            accounts=accounts, categories=categories,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if draft["type"] == "despesa":
        memories = await db.fiint_merchant_memory.find({"user_id": user["id"]}).to_list(500)
        learned = learned_category(payload.text, memories, categories)
        if learned:
            draft["category_id"] = learned
            draft["category_source"] = "user_confirmed_memory"
    return {"engine": "FIINT", "draft": draft}

class MerchantCorrectionIn(BaseModel):
    merchant: str = Field(min_length=2, max_length=80)
    category_id: str = Field(min_length=1, max_length=120)


@router.post("/registration/learn-category")
async def learn_category(payload: MerchantCorrectionIn, user: dict = Depends(require_user)):
    key = merchant_key(payload.merchant)
    if len(key) < 2:
        raise HTTPException(status_code=422, detail="Estabelecimento inválido.")
    category = await db.categories.find_one({"id": payload.category_id, "user_id": user["id"]})
    if not category:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    await db.fiint_merchant_memory.update_one(
        {"user_id": user["id"], "merchant": key},
        {"$set": {"category_id": payload.category_id}},
        upsert=True,
    )
    return {"learned": True, "merchant": key, "category_id": payload.category_id}


@router.delete("/registration/learn-category/{merchant}")
async def forget_category(merchant: str, user: dict = Depends(require_user)):
    key = merchant_key(merchant)
    await db.fiint_merchant_memory.delete_one({"user_id": user["id"], "merchant": key})
    return {"removed": True}
