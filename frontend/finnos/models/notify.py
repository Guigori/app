"""Reminders (push/e-mail), assinaturas e fatura detalhada.

Mirrors: frontend/src/types/finnos.ts (PushKeys, NotifyPrefs, SubscriptionItem,
InvoiceItem, Invoice, PayInvoiceInput).
"""

from typing import List, Optional

from finnos.lib.money import FinanceModel as BaseModel, Money
from pydantic import ConfigDict, Field


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
    version: int = 1
    id: str
    name: str
    value: Money
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
    notes: Optional[str] = None


class SubscriptionsOut(BaseModel):
    items: List[SubscriptionItem]
    monthly_total: Money
    yearly_total: Money
    income_percent: Money


class InvoiceItem(BaseModel):
    id: str
    name: str
    date: str
    value: Money
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    installment_label: Optional[str] = None


class InvoiceAdjustment(BaseModel):
    id: str
    purchase_id: str
    date: str
    reason: str
    value: Money


class CreditInvoiceIn(BaseModel):
    cycle: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    purchase_id: str = Field(min_length=1, max_length=1500)
    value: Money = Field(gt=0)
    reason: str = Field(min_length=5, max_length=300)



class BankRefundIn(BaseModel):
    cycle: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    purchase_id: str = Field(min_length=1, max_length=1500)
    account_id: str = Field(min_length=1, max_length=1500)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    value: Money = Field(gt=0)
    reason: str = Field(min_length=5, max_length=300)


class BankRefundOut(BaseModel):
    id: str
    purchase_id: str
    account_id: str
    date: str
    reason: str
    value: Money



class Invoice(BaseModel):
    card_id: str
    card_name: str
    cycle_start: str
    cycle_end: str
    due_date: str
    total: Money
    paid: bool
    outstanding: Money = 0
    paid_amount: Money
    paid_at: Optional[str] = None
    items: List[InvoiceItem]
    adjustments: List[InvoiceAdjustment] = Field(default_factory=list)
    adjustment_total: Money = 0
    refunds: List[BankRefundOut] = Field(default_factory=list)
    refund_total: Money = 0


class PayInvoiceIn(BaseModel):
    cycle: Optional[str] = None
    account_id: str
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    value: Optional[Money] = Field(default=None, gt=0)
