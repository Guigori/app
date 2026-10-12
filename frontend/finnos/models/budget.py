from finnos.lib.money import D, installment_portion, FinanceModel, Money
"""Versioned budget-cycle models for FINNOS Budget V2."""
from datetime import date
from typing import List, Literal, Optional
from pydantic import Field, model_validator
BudgetMode = Literal['503020', 'personalizado']
BudgetPeriod = Literal['semanal', 'quinzenal', 'mensal', 'anual']
BudgetPriority = Literal['essencial', 'flexivel', 'meta']
BudgetCycleStatus = Literal['programado', 'ativo', 'fechado']

class BudgetAllocationIn(FinanceModel):
    category_id: str
    planned: Money = Field(default=0, ge=0)
    priority: BudgetPriority = 'flexivel'
    rollover: bool = False

class BudgetAllocationOut(BudgetAllocationIn):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None

class BudgetCycleIn(FinanceModel):
    mode: BudgetMode
    period: BudgetPeriod
    start_date: date
    end_date: date
    expected_income: Money = Field(default=0, ge=0)
    allocations: List[BudgetAllocationIn] = Field(default_factory=list)
    extraordinary: bool = False
    notes: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError('end_date deve ser igual ou posterior a start_date')
        return self

class BudgetAllocationProgress(BudgetAllocationOut):
    spent: Money = 0
    committed: Money = 0
    available: Money = 0
    projected_close: Money = 0
    percent: Money = 0

class BudgetCycleProgress(FinanceModel):
    cycle_id: str
    start_date: date
    end_date: date
    planned: Money
    spent: Money
    committed: Money
    available: Money
    projected_close: Money
    expected_income: Money
    received_income: Money
    committed_income: Money
    safe_to_spend: Money
    elapsed_percent: Money
    used_percent: Money
    pace: Literal['sem_plano', 'abaixo', 'no_ritmo', 'acima']
    allocations: List[BudgetAllocationProgress] = Field(default_factory=list)

class BudgetCycleOut(BudgetCycleIn):
    id: str
    status: BudgetCycleStatus
    created_at: str
    closed_at: Optional[str] = None
    allocations: List[BudgetAllocationOut] = Field(default_factory=list)
