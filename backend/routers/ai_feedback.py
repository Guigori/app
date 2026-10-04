"""Feedback on FINNOS IA answers. Financial context is not stored here by default."""

from datetime import datetime, timezone
from typing import Literal, Optional
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from lib.db import db
from routers.auth import require_user

router = APIRouter(prefix="/ai/feedback", tags=["ai-feedback"])

class AiFeedbackIn(BaseModel):
    rating: Literal["up", "down"]
    reason: Optional[Literal["incorrect", "misunderstood", "wrong_value", "not_useful", "other"]] = None
    comment: Optional[str] = Field(default=None, max_length=1000)
    response_id: Optional[str] = Field(default=None, max_length=100)

@router.post("")
async def create_feedback(payload: AiFeedbackIn, user: dict = Depends(require_user)) -> dict:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "rating": payload.rating,
        "reason": payload.reason,
        "comment": payload.comment,
        "response_id": payload.response_id,
        "created_at": datetime.now(timezone.utc),
    }
    await db.ai_feedback.insert_one(doc)
    return {"ok": True, "id": doc["id"]}
