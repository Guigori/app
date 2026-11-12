"""UID-scoped financial institution registry, explicitly managed by the owner.

Every account (except cash) and every card belongs to an institution, and the
institution decides the color. A card's issuer is independent of the account
that pays it. Known banks and benefit providers come from a fixed catalog; a
typed name only matches an existing institution with exactly the same name.
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from finnos.lib.db import db
from finnos.lib.institution_catalog import CATALOG
from finnos.lib.institution_links import create_institution_doc, link_legacy
from finnos.models.institutions import InstitutionCatalogItem, InstitutionIn, InstitutionOut, LegacyLinkResult
from finnos.routers.auth import require_user

router = APIRouter(prefix="/institutions", tags=["institutions"])


def _out(d: dict) -> InstitutionOut:
    return InstitutionOut(
        id=d["id"], name=d["name"], color=d.get("color", "#5B35FF"),
        kind=d.get("kind", "outro"), catalog_id=d.get("catalog_id"), created_at=d["created_at"],
    )


@router.get("", response_model=list[InstitutionOut])
async def list_institutions(user: dict = Depends(require_user)):
    docs = await db.institutions.find({"user_id": user["id"]}).sort("created_at", 1).to_list(500)
    return [_out(d) for d in docs]


@router.get("/catalog", response_model=list[InstitutionCatalogItem])
async def institution_catalog(user: dict = Depends(require_user)):
    return [InstitutionCatalogItem(**item) for item in CATALOG]


@router.post("", response_model=InstitutionOut, status_code=201)
async def create_institution(payload: InstitutionIn, response: Response, user: dict = Depends(require_user)):
    doc, created = await create_institution_doc(user["id"], payload.name, payload.catalog_id)
    if not created:
        # The same name is already registered: hand it back instead of a duplicate.
        response.status_code = 200
    return _out(doc)


@router.post("/link-legacy", response_model=LegacyLinkResult)
async def link_legacy_institutions(user: dict = Depends(require_user)):
    """Link accounts and cards that only have the bank name as text. Idempotent."""
    return LegacyLinkResult(**await link_legacy(user["id"]))


@router.delete("/{institution_id}", status_code=204, response_class=Response)
async def delete_institution(institution_id: str, user: dict = Depends(require_user)):
    # Adapter refuses deletion while any account or card references this entity.
    deleted = await db.institutions.delete_one({"id": institution_id, "user_id": user["id"]})
    if not deleted.deleted_count:
        raise HTTPException(404, "Instituição não encontrada.")
    return Response(status_code=204)
