"""Analytics models. Mirror: frontend/src/types/finnos.ts (MonthTrend, BudgetRow,
BudgetSummary, FlowPoint, FlowOut, DayFlow, CalendarOut)."""

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


# --- Fluxo (cash flow screen) ----------------------------------------------


class FlowPoint(BaseModel):
    month: str
    label: str
    year: str
    income: float
    expense: float
    net: float
    projected_income: float
    projected_expense: float
    projected_net: float
    future: bool


class FlowCategory(BaseModel):
    category_id: Optional[str]
    name: str
    color: str
    icon: str
    total: float
    percent: float


class FlowOut(BaseModel):
    month: str
    from_month: str
    to_month: str
    income: float
    expense: float
    net: float
    projected_income: float
    projected_expense: float
    projected_net: float
    total_income: float
    total_expense: float
    total_net: float
    series: List[FlowPoint]
    categories: List[FlowCategory]


# --- Calendário de transações ----------------------------------------------


class DayFlow(BaseModel):
    date: str
    income: float
    expense: float
    projected_income: float
    projected_expense: float
    count: int


class CalendarOut(BaseModel):
    month: str
    days: List[DayFlow]
    income: float
    expense: float
    net: float
    projected_income: float
    projected_expense: float
    projected_balance: float
