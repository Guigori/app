from pydantic import BaseModel, Field

class FACLiquidity(BaseModel):
    balance_cents: int
    known_commitments_cents: int
    available_financial_cents: int
    protected_cents: int
    safety_margin_cents: int
    free_to_decide_cents: int

class FACState(BaseModel):
    schema_version: str = "1.1"
    state_version: int = 1
    calculated_at: str | None = None
    effective_at: str | None = None
    liquidity: FACLiquidity | None = None
    active_analysis_ids: list[str] = Field(default_factory=list)
    active_radar_ids: list[str] = Field(default_factory=list)

def calculate_liquidity(*, balance_cents: int, known_commitments_cents: int = 0,
                        protected_cents: int = 0, safety_margin_cents: int = 0,
                        credit_limit_cents: int = 0) -> FACLiquidity:
    available = balance_cents - known_commitments_cents
    free = available - protected_cents - safety_margin_cents
    return FACLiquidity(
        balance_cents=balance_cents,
        known_commitments_cents=known_commitments_cents,
        available_financial_cents=available,
        protected_cents=protected_cents,
        safety_margin_cents=safety_margin_cents,
        free_to_decide_cents=free,
    )
