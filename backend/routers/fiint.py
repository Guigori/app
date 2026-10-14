"""Canonical FIINT endpoints. FAC remains available for legacy consumers.

All reads pass through the existing authenticated, user-scoped FAC data adapter.
No new database or unverified learning model is introduced.
"""
from datetime import date
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
