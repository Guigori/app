from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

InstitutionKind = Literal["banco", "beneficio", "outro"]


class InstitutionIn(BaseModel):
    """Either a catalog entry or a typed name. The color always comes from the
    institution (catalog color, or a stable one for custom names); a color sent
    by older clients is accepted and ignored."""
    name: str = Field(default="", max_length=60)
    catalog_id: Optional[str] = Field(default=None, max_length=40)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")

    @model_validator(mode="after")
    def name_or_catalog(self):
        if not self.catalog_id and len(" ".join(self.name.split())) < 2:
            raise ValueError("Informe o nome da instituição.")
        return self


class InstitutionOut(BaseModel):
    id: str
    name: str
    color: str
    kind: InstitutionKind = "outro"
    catalog_id: Optional[str] = None
    created_at: datetime


class InstitutionCatalogItem(BaseModel):
    id: str
    name: str
    color: str
    kind: InstitutionKind


class LegacyLinkResult(BaseModel):
    linked_accounts: int
    linked_cards: int
    created_institutions: int
