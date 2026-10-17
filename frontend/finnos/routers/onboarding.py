"""Onboarding preferences for a verified Firebase UID.

This document never contains banking credentials, statement contents or demo transactions.
Only the FastAPI Admin SDK reads/writes it; client Firestore access is not required.
Legacy accounts without a state document are left on their existing Home.
"""
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator

from finnos.lib.db import client, root
from finnos.routers.auth import require_user

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

Status = Literal["legacy", "not_started", "in_progress", "skipped", "completed"]
Mode = Literal["503020", "personalizado"]


class Percentages(BaseModel):
    necessidades: int = Field(ge=0, le=100)
    desejos: int = Field(ge=0, le=100)
    metas: int = Field(ge=0, le=100)

    @model_validator(mode="after")
    def sum_is_100(self):
        if self.necessidades + self.desejos + self.metas != 100:
            raise ValueError("Os percentuais devem totalizar 100%.")
        return self


class OnboardingPatch(BaseModel):
    status: Optional[Literal["in_progress", "skipped", "completed"]] = None
    step: Optional[int] = Field(default=None, ge=0, le=5)
    income_cents: Optional[int] = Field(default=None, ge=0, le=100000000000)
    budget_mode: Optional[Mode] = None
    budget_percentages: Optional[Percentages] = None
    first_entry_seen: Optional[bool] = None
    tour_seen: Optional[bool] = None


def _reference(uid: str):
    # root() verifies the resource identifier, and client() verifies Firebase project.
    return root(client(), uid).collection("onboarding").document("state")


def _default():
    return {
        "version": 1, "status": "legacy", "step": 0,
        "income_cents": None, "budget_mode": "503020",
        "budget_percentages": {"necessidades": 50, "desejos": 30, "metas": 20},
        "first_entry_seen": False, "tour_seen": False,
    }


def _read(ref):
    snapshot = ref.get(timeout=10)
    return {**_default(), **(snapshot.to_dict() or {})}


@router.get("")
def get_onboarding(user: dict = Depends(require_user)):
    return _read(_reference(user["id"]))


@router.post("/start")
def start_onboarding(user: dict = Depends(require_user)):
    ref = _reference(user["id"])
    state = _read(ref)
    if state["status"] in {"legacy", "skipped"}:
        ref.set({
            "version": 1, "status": "in_progress", "step": state["step"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, merge=True, timeout=10)
        return _read(ref)
    return state


@router.patch("")
def patch_onboarding(payload: OnboardingPatch, user: dict = Depends(require_user)):
    ref = _reference(user["id"])
    patch = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "budget_percentages" in patch and payload.budget_percentages:
        patch["budget_percentages"] = payload.budget_percentages.model_dump()
    if patch.get("budget_mode") == "503020":
        patch["budget_percentages"] = {"necessidades": 50, "desejos": 30, "metas": 20}
    if patch:
        patch.update({"version": 1, "updated_at": datetime.now(timezone.utc).isoformat()})
        ref.set(patch, merge=True, timeout=10)
    return _read(ref)
