"""Versioned budget-cycle models for FINNOS Budget V2."""

from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

BudgetMode = Literal["503020", "personalizado"]
BudgetPeriod = Literal["semanal", "quinzenal", "mensal", "anual"]
BudgetPriority = Literal["essencial", "flexivel", "meta"]
BudgetCycleStatus = Literal["programado", "ativo", "fechado"]


class BudgetAllocationIn(BaseModel):
    category_id: str
    planned: float = Field(default=0, ge=0)
    priority: BudgetPriority = "flexivel"
    rollover: bool = False


class BudgetAllocationOut(BudgetAllocationIn):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None


class BudgetCycleIn(BaseModel):
    mode: BudgetMode
    period: BudgetPeriod
    start_date: date
    end_date: date
    expected_income: float = Field(default=0, ge=0)
    allocations: List[BudgetAllocationIn] = Field(default_factory=list)
    extraordinary: bool = False
    notes: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date deve ser igual ou posterior a start_date")
        return self


class BudgetAllocationProgress(BudgetAllocationOut):
    spent: float = 0
    committed: float = 0
    available: float = 0
    projected_close: float = 0
    percent: float = 0


class BudgetCycleProgress(BaseModel):
    cycle_id: str
    start_date: date
    end_date: date
    planned: float
    spent: float
    committed: float
    available: float
    projected_close: float
    expected_income: float
    received_income: float
    committed_income: float
    safe_to_spend: float
    elapsed_percent: float
    used_percent: float
    pace: Literal["sem_plano", "abaixo", "no_ritmo", "acima"]
    allocations: List[BudgetAllocationProgress] = Field(default_factory=list)


class BudgetCycleOut(BudgetCycleIn):
    id: str
    status: BudgetCycleStatus
    created_at: str
    closed_at: Optional[str] = None
    allocations: List[BudgetAllocationOut] = Field(default_factory=list)
