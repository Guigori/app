"""FINNOS resource models (Pydantic v2).

Every model here has a hand-written TS mirror in frontend/src/types/finnos.ts —
keep the two in sync in the same edit.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

TxType = Literal["receita", "despesa", "transferencia"]
TxStatus = Literal["pago", "pendente", "agendado"]
CategoryGroup = Literal["necessidades", "desejos", "metas"]
AccountType = Literal["corrente", "salario", "digital", "poupanca", "carteira"]

HEX_PATTERN = r"^#[0-9a-fA-F]{6}$"
DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"


# --- Accounts ---------------------------------------------------------------


class AccountOut(BaseModel):
    id: str
    name: str
    institution: str = ""
    type: AccountType = "corrente"
    color: str = "#070F52"
    initial_balance: float = 0.0
    active: bool = True
    balance: float = 0.0
    total_income: float = 0.0
    total_expense: float = 0.0
    created_at: datetime


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    institution: str = Field(default="", max_length=60)
    type: AccountType = "corrente"
    color: str = Field(default="#070F52", pattern=HEX_PATTERN)
    initial_balance: float = Field(default=0.0, ge=0)
    active: bool = True


class AccountDetailOut(BaseModel):
    account: AccountOut
    transactions: List["TransactionOut"]


# --- Categories -------------------------------------------------------------


class CategoryOut(BaseModel):
    id: str
    name: str
    icon: str = "more-horizontal"
    color: str = "#64748B"
    group: CategoryGroup = "necessidades"
    monthly_budget: float = Field(default=0.0, ge=0)
    monthly_goal: float = Field(default=0.0, ge=0)
    created_at: datetime


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    icon: str = "more-horizontal"
    color: str = Field(default="#64748B", pattern=HEX_PATTERN)
    group: CategoryGroup = "necessidades"
    monthly_budget: float = Field(default=0.0, ge=0)
    monthly_goal: float = Field(default=0.0, ge=0)


# --- Transactions -----------------------------------------------------------


class TransactionOut(BaseModel):
    id: str
    name: str
    value: float
    type: TxType
    status: TxStatus = "pago"
    date: str  # YYYY-MM-DD (plain ISO date, sortable as string)
    account_id: str
    account_name: str = ""
    card_id: Optional[str] = None
    card_name: Optional[str] = None
    to_account_id: Optional[str] = None
    to_account_name: Optional[str] = None
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    category_icon: Optional[str] = None
    fixed: bool = False
    recurrence: Optional[str] = None
    installment: bool = False
    total_installments: Optional[int] = None
    current_installment: Optional[int] = None
    installment_value: Optional[float] = None
    adjusted_value: Optional[float] = None
    attachment: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime


class TransactionIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    value: float = Field(gt=0)
    type: TxType
    status: TxStatus = "pago"
    date: str = Field(pattern=DATE_PATTERN)
    account_id: str
    card_id: Optional[str] = None
    to_account_id: Optional[str] = None
    category_id: Optional[str] = None
    fixed: bool = False
    recurrence: Optional[str] = None  # "mensal" today; recurrence engine comes later
    installment: bool = False
    total_installments: Optional[int] = Field(default=None, ge=2, le=120)
    current_installment: Optional[int] = Field(default=None, ge=1)
    adjusted_value: Optional[float] = Field(default=None, gt=0)
    attachment: Optional[str] = Field(default=None, max_length=300)
    notes: Optional[str] = Field(default=None, max_length=500)


# --- Dashboard --------------------------------------------------------------


class CategorySlice(BaseModel):
    category_id: Optional[str] = None
    name: str
    color: str
    icon: str
    total: float
    percent: float


class RuleItem(BaseModel):
    key: CategoryGroup
    label: str
    spent: float
    limit: float
    percent: float
    status: Literal["dentro", "proximo", "acima"]


class DashboardOut(BaseModel):
    month: str
    total_balance: float
    income: float
    expense: float
    month_balance: float
    prev_income: Optional[float] = None
    prev_expense: Optional[float] = None
    invested: float = 0.0
    categories: List[CategorySlice]
    rule: List[RuleItem]
    recent: List[TransactionOut]
