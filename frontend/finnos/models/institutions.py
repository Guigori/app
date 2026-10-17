"""Financial institution as an owner-scoped entity; not a bank account connection."""
from datetime import datetime
from pydantic import Field
from finnos.lib.money import FinanceModel as BaseModel

class InstitutionIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    color: str = Field(default="#5B35FF", pattern=r"^#[0-9a-fA-F]{6}$")

class InstitutionOut(InstitutionIn):
    id: str
    created_at: datetime
