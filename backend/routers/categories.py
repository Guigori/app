"""Categories CRUD — every category belongs to a user and carries its 50/30/20 group."""

import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response

from lib.db import db
from lib.stats import aware
from models.finnos import CategoryIn, CategoryOut
from routers.auth import require_user

router = APIRouter(prefix="/categories", tags=["categories"])


def _out(doc: dict) -> CategoryOut:
    return CategoryOut(
        id=doc["id"],
        name=doc["name"],
        icon=doc.get("icon", "more-horizontal"),
        color=doc.get("color", "#64748B"),
        group=doc.get("group", "necessidades"),
        monthly_budget=float(doc.get("monthly_budget") or 0.0),
        monthly_goal=float(doc.get("monthly_goal") or 0.0),
        created_at=aware(doc.get("created_at")) or datetime.now(timezone.utc),
    )


@router.get("", response_model=List[CategoryOut])
async def list_categories(user: dict = Depends(require_user)) -> list[CategoryOut]:
    docs = await db.categories.find({"user_id": user["id"]}).sort("created_at", 1).to_list(500)
    return [_out(d) for d in docs]


@router.post("", response_model=CategoryOut, status_code=201)
async def create_category(payload: CategoryIn, user: dict = Depends(require_user)) -> CategoryOut:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        **payload.model_dump(),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.categories.insert_one(doc)
    return _out(doc)


@router.put("/{category_id}", response_model=CategoryOut)
async def update_category(category_id: str, payload: CategoryIn, user: dict = Depends(require_user)) -> CategoryOut:
    result = await db.categories.update_one(
        {"id": category_id, "user_id": user["id"]},
        {"$set": {**payload.model_dump(), "updated_at": datetime.now(timezone.utc)}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    doc = await db.categories.find_one({"id": category_id, "user_id": user["id"]})
    return _out(doc)


@router.delete("/{category_id}", status_code=204)
async def delete_category(category_id: str, user: dict = Depends(require_user)) -> None:
    used = await db.transactions.count_documents({"user_id": user["id"], "category_id": category_id})
    if used:
        raise HTTPException(
            status_code=409,
            detail="Esta categoria tem transações vinculadas. Mova-as para outra categoria antes de excluir.",
        )
    result = await db.categories.delete_one({"id": category_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
