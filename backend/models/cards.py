"""Credit cards + notifications models.

Mirrors: frontend/src/types/finnos.ts (Card, CardInput, NotificationItem).
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

HEX_PATTERN = r"^#[0-9a-fA-F]{6}$"


class CardIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    institution: str = Field(default="", max_length=60)
    color: str = Field(default="#5B3FE4", pattern=HEX_PATTERN)
    limit: float = Field(gt=0)
    closing_day: int = Field(ge=1, le=28)
    due_day: int = Field(ge=1, le=28)
    payment_account_id: Optional[str] = None
    active: bool = True


class CardOut(BaseModel):
    id: str
    name: str
    institution: str
    color: str
    limit: float
    closing_day: int
    due_day: int
    payment_account_id: Optional[str] = None
    payment_account_name: Optional[str] = None
    active: bool
    invoice_paid: bool = False
    # Derived, never stored:
    current_invoice: float
    future_installments: float
    used: float
    available: float
    used_percent: float
    cycle_start: str
    next_closing: str
    next_due: str
    best_purchase_day: str
    created_at: datetime


NotificationKind = Literal["vencimento", "atrasado", "fatura"]


class NotificationItem(BaseModel):
    id: str
    kind: NotificationKind
    title: str
    description: str
    date: str
    value: float
    days_left: int
    target_url: str


class NotificationsOut(BaseModel):
    items: List[NotificationItem]
    count: int
