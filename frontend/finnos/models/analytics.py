"""Analytics models. Mirror: frontend/src/types/finnos.ts (MonthTrend, BudgetRow,
BudgetSummary, FlowPoint, FlowOut, DayFlow, CalendarOut)."""

from typing import List, Literal, Optional

from finnos.lib.money import FinanceModel as BaseModel, Money
from pydantic import ConfigDict

BudgetStatus = Literal["sem_limite", "dentro", "proximo", "acima"]


class MonthTrend(BaseModel):
    month: str
    label: str
    income: Money
    expense: Money
    net: Money


class TrendsOut(BaseModel):
    months: List[MonthTrend]
    total_income: Money
    total_expense: Money


class BudgetRow(BaseModel):
    category_id: str
    name: str
    icon: str
    color: str
    group: str
    budget: Money
    spent: Money
    remaining: Money
    percent: Money
    status: BudgetStatus
    pace_day: int = 0
    pace_days_in_month: int = 0
    pace_ideal: Money = 0
    pace_daily_allowance: Money = 0
    pace_projected_close: Money = 0
    pace_difference: Money = 0
    pace_cumulative: List[Money] = []


class BudgetSummary(BaseModel):
    month: str
    planned: Money
    spent: Money
    remaining: Money
    percent: Money
    income: Money
    unbudgeted_spent: Money
    rows: List[BudgetRow]


# --- Fluxo (cash flow screen) ----------------------------------------------


class FlowPoint(BaseModel):
    month: str
    label: str
    year: str
    income: Money
    expense: Money
    net: Money
    projected_income: Money
    projected_expense: Money
    projected_net: Money
    future: bool


class FlowCategory(BaseModel):
    category_id: Optional[str]
    name: str
    color: str
    icon: str
    total: Money
    percent: Money


class UpcomingItem(BaseModel):
    """One amount still expected in the focus month; together they make up its projection."""
    date: str
    name: str
    value: Money
    type: Literal["receita", "despesa"]
    kind: Literal["agendado", "pendente", "parcela", "fixa", "assinatura"]
    transaction_id: Optional[str] = None
    subscription_id: Optional[str] = None
    account_id: Optional[str] = None
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    category_color: Optional[str] = None


class FlowOut(BaseModel):
    month: str
    from_month: str
    to_month: str
    income: Money
    expense: Money
    net: Money
    projected_income: Money
    projected_expense: Money
    projected_net: Money
    total_income: Money
    total_expense: Money
    total_net: Money
    series: List[FlowPoint]
    categories: List[FlowCategory]
    upcoming: List[UpcomingItem] = []


# --- Calendário de transações ----------------------------------------------


class DayFlow(BaseModel):
    date: str
    income: Money
    expense: Money
    projected_income: Money
    projected_expense: Money
    count: int


class PlannedCharge(BaseModel):
    """A registered subscription expected on a day; a plan, not a transaction."""
    date: str
    subscription_id: str
    name: str
    value: Money
    account_id: Optional[str] = None
    card_id: Optional[str] = None
    category_id: Optional[str] = None


class CalendarOut(BaseModel):
    month: str
    days: List[DayFlow]
    income: Money
    expense: Money
    net: Money
    projected_income: Money
    projected_expense: Money
    projected_balance: Money
    planned: List[PlannedCharge] = []
