"""UID-scoped financial institution registry, explicitly managed by the owner.

A card's issuer is independent of its payment account. Unlinked legacy names
remain valid: no existing documents are rewritten by these endpoints.
"""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from finnos.lib.db import db
from finnos.models.institutions import InstitutionIn, InstitutionOut
from finnos.routers.auth import require_user

router = APIRouter(prefix="/institutions", tags=["institutions"])

@router.get("", response_model=list[InstitutionOut])
async def list_institutions(user: dict = Depends(require_user)):
    docs = await db.institutions.find({"user_id": user["id"]}).sort("created_at", 1).to_list(500)
    return [InstitutionOut(id=d["id"], name=d["name"], color=d.get("color", "#5B35FF"), created_at=d["created_at"]) for d in docs]

@router.post("", response_model=InstitutionOut, status_code=201)
async def create_institution(payload: InstitutionIn, user: dict = Depends(require_user)):
    name = " ".join(payload.name.split())
    if len(name) < 2:
        raise HTTPException(422, "Informe o nome da instituição.")
    doc = dict(
        id=str(uuid.uuid4()), user_id=user["id"], name=name,
        color=payload.color, created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    # Adapter transactionally rejects duplicate normalized institution names.
    await db.institutions.insert_one(doc)
    return InstitutionOut(id=doc["id"], name=doc["name"], color=doc["color"], created_at=doc["created_at"])

@router.delete("/{institution_id}", status_code=204, response_class=Response)
async def delete_institution(institution_id: str, user: dict = Depends(require_user)):
    # Adapter refuses deletion while any account or card references this entity.
    deleted = await db.institutions.delete_one({"id": institution_id, "user_id": user["id"]})
    if not deleted.deleted_count:
        raise HTTPException(404, "Instituição não encontrada.")
    return Response(status_code=204)
