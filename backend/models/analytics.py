"""Analytics models. Mirror: frontend/src/types/finnos.ts (MonthTrend, BudgetRow, BudgetSummary)."""

from typing import List, Literal, Optional

from pydantic import BaseModel

BudgetStatus = Literal["sem_limite", "dentro", "proximo", "acima"]


class MonthTrend(BaseModel):
    month: str
    label: str
    income: float
    expense: float
    net: float


class TrendsOut(BaseModel):
    months: List[MonthTrend]
    total_income: float
    total_expense: float


class BudgetRow(BaseModel):
    category_id: str
    name: str
    icon: str
    color: str
    group: str
    budget: float
    spent: float
    remaining: float
    percent: float
    status: BudgetStatus


class BudgetSummary(BaseModel):
    month: str
    planned: float
    spent: float
    remaining: float
    percent: float
    income: float
    unbudgeted_spent: float
    rows: List[BudgetRow]
