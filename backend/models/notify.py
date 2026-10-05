"""Reminders (push/e-mail), assinaturas e fatura detalhada.

Mirrors: frontend/src/types/finnos.ts (PushKeys, NotifyPrefs, SubscriptionItem,
InvoiceItem, Invoice, PayInvoiceInput).
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=600)
    keys: PushKeys


class NotifyPrefsIn(BaseModel):
    push_enabled: bool = True
    email_enabled: bool = False
    # Local hour (America/Sao_Paulo) the reminder should arrive.
    hour: int = Field(default=9, ge=0, le=23)
    # How many days before the due date to warn.
    days_before: int = Field(default=1, ge=0, le=7)
    transaction_reminders: bool = True
    invoice_reminders: bool = True
    radar_alerts: bool = True
    activity_reminders: bool = True
    weekly_summary: bool = True
    system_notices: bool = True


class NotifyPrefsOut(NotifyPrefsIn):
    push_devices: int
    push_supported: bool


class SubscriptionItem(BaseModel):
    id: str
    name: str
    value: float
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    account_id: str
    account_name: str
    card_id: Optional[str] = None
    card_name: Optional[str] = None
    recurrence: str
    next_charge: str
    active: bool


class SubscriptionsOut(BaseModel):
    items: List[SubscriptionItem]
    monthly_total: float
    yearly_total: float
    income_percent: float


class InvoiceItem(BaseModel):
    id: str
    name: str
    date: str
    value: float
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    installment_label: Optional[str] = None


class Invoice(BaseModel):
    card_id: str
    card_name: str
    cycle_start: str
    cycle_end: str
    due_date: str
    total: float
    paid: bool
    paid_amount: float
    paid_at: Optional[str] = None
    items: List[InvoiceItem]


class PayInvoiceIn(BaseModel):
    account_id: str
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    value: Optional[float] = Field(default=None, gt=0)
