# Comparação linha a linha — modelos, cálculos, contas e categorias

Origem: `Guigori/app`, branch `main` em 14/10/2026. `=` linha idêntica, `-` apenas versão Mongo legada, `+` apenas versão Firestore/Vercel. `L` = linha antiga, `F` = linha ativa. Mudanças apenas de formatação aparecem literalmente; **o diff textual não comprova equivalência semântica**.


## backend/models/finnos.py ↔ frontend/finnos/models/finnos.py

Linhas legado 162; ativo 165.

```text
L---- | F---- | código
= 0001 | 0001 | """FINNOS resource models (Pydantic v2).
= 0002 | 0002 | 
= 0003 | 0003 | Every model here has a hand-written TS mirror in frontend/src/types/finnos.ts —
= 0004 | 0004 | keep the two in sync in the same edit.
= 0005 | 0005 | """
= 0006 | 0006 | 
= 0007 | 0007 | from datetime import datetime
= 0008 | 0008 | from typing import List, Literal, Optional
= 0009 | 0009 | 
- 0010 | ---- | from pydantic import BaseModel, Field
+ ---- | 0010 | from finnos.lib.money import FinanceModel as BaseModel, Money
+ ---- | 0011 | from pydantic import ConfigDict, Field
= 0011 | 0012 | 
= 0012 | 0013 | TxType = Literal["receita", "despesa", "transferencia"]
= 0013 | 0014 | TxStatus = Literal["pago", "pendente", "agendado"]
= 0014 | 0015 | CategoryGroup = Literal["necessidades", "desejos", "metas"]
= 0015 | 0016 | AccountType = Literal["corrente", "salario", "digital", "poupanca", "carteira"]
= 0016 | 0017 | 
= 0017 | 0018 | HEX_PATTERN = r"^#[0-9a-fA-F]{6}$"
= 0018 | 0019 | DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"
= 0019 | 0020 | 
= 0020 | 0021 | 
= 0021 | 0022 | # --- Accounts ---------------------------------------------------------------
= 0022 | 0023 | 
= 0023 | 0024 | 
= 0024 | 0025 | class AccountOut(BaseModel):
= 0025 | 0026 |     id: str
= 0026 | 0027 |     name: str
= 0027 | 0028 |     institution: str = ""
= 0028 | 0029 |     type: AccountType = "corrente"
= 0029 | 0030 |     color: str = "#070F52"
- 0030 | ---- |     initial_balance: float = 0.0
+ ---- | 0031 |     initial_balance: Money = 0.0
= 0031 | 0032 |     active: bool = True
- 0032 | ---- |     balance: float = 0.0
- 0033 | ---- |     total_income: float = 0.0
- 0034 | ---- |     total_expense: float = 0.0
+ ---- | 0033 |     balance: Money = 0.0
+ ---- | 0034 |     total_income: Money = 0.0
+ ---- | 0035 |     total_expense: Money = 0.0
= 0035 | 0036 |     created_at: datetime
= 0036 | 0037 | 
= 0037 | 0038 | 
= 0038 | 0039 | class AccountIn(BaseModel):
= 0039 | 0040 |     name: str = Field(min_length=1, max_length=60)
= 0040 | 0041 |     institution: str = Field(default="", max_length=60)
= 0041 | 0042 |     type: AccountType = "corrente"
= 0042 | 0043 |     color: str = Field(default="#070F52", pattern=HEX_PATTERN)
- 0043 | ---- |     initial_balance: float = Field(default=0.0, ge=0)
+ ---- | 0044 |     initial_balance: Money = Field(default=0.0, ge=0)
= 0044 | 0045 |     active: bool = True
= 0045 | 0046 | 
= 0046 | 0047 | 
= 0047 | 0048 | class AccountDetailOut(BaseModel):
= 0048 | 0049 |     account: AccountOut
= 0049 | 0050 |     transactions: List["TransactionOut"]
= 0050 | 0051 | 
= 0051 | 0052 | 
= 0052 | 0053 | # --- Categories -------------------------------------------------------------
= 0053 | 0054 | 
= 0054 | 0055 | 
= 0055 | 0056 | class CategoryOut(BaseModel):
= 0056 | 0057 |     id: str
= 0057 | 0058 |     name: str
= 0058 | 0059 |     icon: str = "more-horizontal"
= 0059 | 0060 |     color: str = "#64748B"
= 0060 | 0061 |     group: CategoryGroup = "necessidades"
- 0061 | ---- |     monthly_budget: float = Field(default=0.0, ge=0)
- 0062 | ---- |     monthly_goal: float = Field(default=0.0, ge=0)
+ ---- | 0062 |     monthly_budget: Money = Field(default=0.0, ge=0)
+ ---- | 0063 |     monthly_goal: Money = Field(default=0.0, ge=0)
= 0063 | 0064 |     created_at: datetime
= 0064 | 0065 | 
= 0065 | 0066 | 
= 0066 | 0067 | class CategoryIn(BaseModel):
= 0067 | 0068 |     name: str = Field(min_length=1, max_length=40)
= 0068 | 0069 |     icon: str = "more-horizontal"
= 0069 | 0070 |     color: str = Field(default="#64748B", pattern=HEX_PATTERN)
= 0070 | 0071 |     group: CategoryGroup = "necessidades"
- 0071 | ---- |     monthly_budget: float = Field(default=0.0, ge=0)
- 0072 | ---- |     monthly_goal: float = Field(default=0.0, ge=0)
+ ---- | 0072 |     monthly_budget: Money = Field(default=0.0, ge=0)
+ ---- | 0073 |     monthly_goal: Money = Field(default=0.0, ge=0)
= 0073 | 0074 | 
= 0074 | 0075 | 
= 0075 | 0076 | # --- Transactions -----------------------------------------------------------
= 0076 | 0077 | 
= 0077 | 0078 | 
= 0078 | 0079 | class TransactionOut(BaseModel):
+ ---- | 0080 |     invoice_payment: bool = False
+ ---- | 0081 |     version: int = 1
= 0079 | 0082 |     id: str
= 0080 | 0083 |     name: str
- 0081 | ---- |     value: float
+ ---- | 0084 |     value: Money
= 0082 | 0085 |     type: TxType
= 0083 | 0086 |     status: TxStatus = "pago"
= 0084 | 0087 |     date: str  # YYYY-MM-DD (plain ISO date, sortable as string)
= 0085 | 0088 |     account_id: str
= 0086 | 0089 |     account_name: str = ""
= 0087 | 0090 |     card_id: Optional[str] = None
= 0088 | 0091 |     card_name: Optional[str] = None
= 0089 | 0092 |     to_account_id: Optional[str] = None
= 0090 | 0093 |     to_account_name: Optional[str] = None
= 0091 | 0094 |     category_id: Optional[str] = None
= 0092 | 0095 |     category_name: Optional[str] = None
= 0093 | 0096 |     category_color: Optional[str] = None
= 0094 | 0097 |     category_icon: Optional[str] = None
= 0095 | 0098 |     fixed: bool = False
= 0096 | 0099 |     recurrence: Optional[str] = None
= 0097 | 0100 |     installment: bool = False
= 0098 | 0101 |     total_installments: Optional[int] = None
= 0099 | 0102 |     current_installment: Optional[int] = None
- 0100 | ---- |     installment_value: Optional[float] = None
- 0101 | ---- |     adjusted_value: Optional[float] = None
+ ---- | 0103 |     installment_value: Optional[Money] = None
+ ---- | 0104 |     adjusted_value: Optional[Money] = None
= 0102 | 0105 |     attachment: Optional[str] = None
= 0103 | 0106 |     notes: Optional[str] = None
= 0104 | 0107 |     notify_enabled: bool = True
= 0105 | 0108 |     created_at: datetime
= 0106 | 0109 | 
= 0107 | 0110 | 
= 0108 | 0111 | class TransactionIn(BaseModel):
= 0109 | 0112 |     name: str = Field(min_length=1, max_length=80)
- 0110 | ---- |     value: float = Field(gt=0)
+ ---- | 0113 |     value: Money = Field(gt=0)
= 0111 | 0114 |     type: TxType
= 0112 | 0115 |     status: TxStatus = "pago"
= 0113 | 0116 |     date: str = Field(pattern=DATE_PATTERN)
= 0114 | 0117 |     account_id: str
= 0115 | 0118 |     card_id: Optional[str] = None
= 0116 | 0119 |     to_account_id: Optional[str] = None
= 0117 | 0120 |     category_id: Optional[str] = None
= 0118 | 0121 |     fixed: bool = False
= 0119 | 0122 |     recurrence: Optional[str] = None  # "mensal" today; recurrence engine comes later
= 0120 | 0123 |     installment: bool = False
= 0121 | 0124 |     total_installments: Optional[int] = Field(default=None, ge=2, le=120)
= 0122 | 0125 |     current_installment: Optional[int] = Field(default=None, ge=1)
- 0123 | ---- |     adjusted_value: Optional[float] = Field(default=None, gt=0)
+ ---- | 0126 |     adjusted_value: Optional[Money] = Field(default=None, gt=0)
= 0124 | 0127 |     attachment: Optional[str] = Field(default=None, max_length=300)
= 0125 | 0128 |     notes: Optional[str] = Field(default=None, max_length=500)
= 0126 | 0129 |     notify_enabled: bool = True
= 0127 | 0130 | 
= 0128 | 0131 | 
= 0129 | 0132 | # --- Dashboard --------------------------------------------------------------
= 0130 | 0133 | 
= 0131 | 0134 | 
= 0132 | 0135 | class CategorySlice(BaseModel):
= 0133 | 0136 |     category_id: Optional[str] = None
= 0134 | 0137 |     name: str
= 0135 | 0138 |     color: str
= 0136 | 0139 |     icon: str
- 0137 | ---- |     total: float
- 0138 | ---- |     percent: float
+ ---- | 0140 |     total: Money
+ ---- | 0141 |     percent: Money
= 0139 | 0142 | 
= 0140 | 0143 | 
= 0141 | 0144 | class RuleItem(BaseModel):
= 0142 | 0145 |     key: CategoryGroup
= 0143 | 0146 |     label: str
- 0144 | ---- |     spent: float
- 0145 | ---- |     limit: float
- 0146 | ---- |     percent: float
+ ---- | 0147 |     spent: Money
+ ---- | 0148 |     limit: Money
+ ---- | 0149 |     percent: Money
= 0147 | 0150 |     status: Literal["dentro", "proximo", "acima"]
= 0148 | 0151 | 
= 0149 | 0152 | 
= 0150 | 0153 | class DashboardOut(BaseModel):
= 0151 | 0154 |     month: str
- 0152 | ---- |     total_balance: float
- 0153 | ---- |     income: float
- 0154 | ---- |     expense: float
- 0155 | ---- |     month_balance: float
- 0156 | ---- |     prev_income: Optional[float] = None
- 0157 | ---- |     prev_expense: Optional[float] = None
- 0158 | ---- |     invested: float = 0.0
+ ---- | 0155 |     total_balance: Money
+ ---- | 0156 |     income: Money
+ ---- | 0157 |     expense: Money
+ ---- | 0158 |     month_balance: Money
+ ---- | 0159 |     prev_income: Optional[Money] = None
+ ---- | 0160 |     prev_expense: Optional[Money] = None
+ ---- | 0161 |     invested: Money = 0.0
= 0159 | 0162 |     categories: List[CategorySlice]
= 0160 | 0163 |     rule: List[RuleItem]
= 0161 | 0164 |     recent: List[TransactionOut]
= 0162 | 0165 | 
```


## backend/models/cards.py ↔ frontend/finnos/models/cards.py

Linhas legado 67; ativo 68.

```text
L---- | F---- | código
= 0001 | 0001 | """Credit cards + notifications models.
= 0002 | 0002 | 
= 0003 | 0003 | Mirrors: frontend/src/types/finnos.ts (Card, CardInput, NotificationItem).
= 0004 | 0004 | """
= 0005 | 0005 | 
= 0006 | 0006 | from datetime import datetime
= 0007 | 0007 | from typing import List, Literal, Optional
= 0008 | 0008 | 
- 0009 | ---- | from pydantic import BaseModel, Field
+ ---- | 0009 | from finnos.lib.money import FinanceModel as BaseModel, Money
+ ---- | 0010 | from pydantic import ConfigDict, Field
= 0010 | 0011 | 
= 0011 | 0012 | HEX_PATTERN = r"^#[0-9a-fA-F]{6}$"
= 0012 | 0013 | 
= 0013 | 0014 | 
= 0014 | 0015 | class CardIn(BaseModel):
= 0015 | 0016 |     name: str = Field(min_length=1, max_length=60)
= 0016 | 0017 |     institution: str = Field(default="", max_length=60)
= 0017 | 0018 |     color: str = Field(default="#5B3FE4", pattern=HEX_PATTERN)
- 0018 | ---- |     limit: float = Field(gt=0)
+ ---- | 0019 |     limit: Money = Field(gt=0)
= 0019 | 0020 |     closing_day: int = Field(ge=1, le=28)
= 0020 | 0021 |     due_day: int = Field(ge=1, le=28)
= 0021 | 0022 |     payment_account_id: Optional[str] = None
= 0022 | 0023 |     active: bool = True
= 0023 | 0024 | 
= 0024 | 0025 | 
= 0025 | 0026 | class CardOut(BaseModel):
= 0026 | 0027 |     id: str
= 0027 | 0028 |     name: str
= 0028 | 0029 |     institution: str
= 0029 | 0030 |     color: str
- 0030 | ---- |     limit: float
+ ---- | 0031 |     limit: Money
= 0031 | 0032 |     closing_day: int
= 0032 | 0033 |     due_day: int
= 0033 | 0034 |     payment_account_id: Optional[str] = None
= 0034 | 0035 |     payment_account_name: Optional[str] = None
= 0035 | 0036 |     active: bool
= 0036 | 0037 |     invoice_paid: bool = False
= 0037 | 0038 |     # Derived, never stored:
- 0038 | ---- |     current_invoice: float
- 0039 | ---- |     future_installments: float
- 0040 | ---- |     used: float
- 0041 | ---- |     available: float
- 0042 | ---- |     used_percent: float
+ ---- | 0039 |     current_invoice: Money
+ ---- | 0040 |     future_installments: Money
+ ---- | 0041 |     used: Money
+ ---- | 0042 |     available: Money
+ ---- | 0043 |     used_percent: Money
= 0043 | 0044 |     cycle_start: str
= 0044 | 0045 |     next_closing: str
= 0045 | 0046 |     next_due: str
= 0046 | 0047 |     best_purchase_day: str
= 0047 | 0048 |     created_at: datetime
= 0048 | 0049 | 
= 0049 | 0050 | 
= 0050 | 0051 | NotificationKind = Literal["vencimento", "atrasado", "fatura"]
= 0051 | 0052 | 
= 0052 | 0053 | 
= 0053 | 0054 | class NotificationItem(BaseModel):
= 0054 | 0055 |     id: str
= 0055 | 0056 |     kind: NotificationKind
= 0056 | 0057 |     title: str
= 0057 | 0058 |     description: str
= 0058 | 0059 |     date: str
- 0059 | ---- |     value: float
+ ---- | 0060 |     value: Money
= 0060 | 0061 |     days_left: int
= 0061 | 0062 |     target_url: str
= 0062 | 0063 | 
= 0063 | 0064 | 
= 0064 | 0065 | class NotificationsOut(BaseModel):
= 0065 | 0066 |     items: List[NotificationItem]
= 0066 | 0067 |     count: int
= 0067 | 0068 | 
```


## backend/lib/stats.py ↔ frontend/finnos/lib/stats.py

Linhas legado 86; ativo 88.

```text
L---- | F---- | código
+ ---- | 0001 | from finnos.lib.money import D, installment_portion
+ ---- | 0002 | 
= 0001 | 0003 | """Month & money math shared by FINNOS routers.
= 0002 | 0004 | 
- 0003 | ---- | All amounts are BRL floats rounded to 2 decimals. Transaction dates are plain
+ ---- | 0005 | Amounts use Decimal; storage uses cents, with installment residual reconciliation. Transaction dates are plain
= 0004 | 0006 | "YYYY-MM-DD" strings (sortable, immune to the naive-datetime trap).
= 0005 | 0007 | """
- 0006 | ---- | 
- 0007 | ---- | from __future__ import annotations
- 0008 | ---- | 
= 0009 | 0008 | import calendar
= 0010 | 0009 | from datetime import date, datetime, timezone
- 0011 | ---- | 
- 0012 | ---- | from lib.dates import today_iso
+ ---- | 0010 | from finnos.lib.dates import today_iso
= 0013 | 0011 | 
= 0014 | 0012 | 
= 0015 | 0013 | def aware(dt: datetime | None) -> datetime | None:
= 0016 | 0014 |     """BSON hands naive UTC datetimes back — normalise so Pydantic serialises the offset."""
= 0017 | 0015 |     if isinstance(dt, datetime) and dt.tzinfo is None:
= 0018 | 0016 |         return dt.replace(tzinfo=timezone.utc)
= 0019 | 0017 |     return dt
= 0020 | 0018 | 
= 0021 | 0019 | 
= 0022 | 0020 | def today_date() -> date:
= 0023 | 0021 |     return date.fromisoformat(today_iso())
= 0024 | 0022 | 
= 0025 | 0023 | 
= 0026 | 0024 | def month_bounds(month: str) -> tuple[str, str]:
= 0027 | 0025 |     """'2026-09' -> ('2026-09-01', '2026-09-30')."""
- 0028 | ---- |     y, m = int(month[:4]), int(month[5:7])
+ ---- | 0026 |     y, m = (int(month[:4]), int(month[5:7]))
+ ---- | 0027 |     if not 1 <= m <= 12 or not 1 <= y <= 9999:
+ ---- | 0028 |         from fastapi import HTTPException
+ ---- | 0029 | 
+ ---- | 0030 |         raise HTTPException(422, "Mês inválido.")
= 0029 | 0031 |     last = calendar.monthrange(y, m)[1]
- 0030 | ---- |     return f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{last:02d}"
+ ---- | 0032 |     return (f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{last:02d}")
= 0031 | 0033 | 
= 0032 | 0034 | 
= 0033 | 0035 | def add_months(month: str, delta: int) -> str:
- 0034 | ---- |     y, m = int(month[:4]), int(month[5:7])
+ ---- | 0036 |     y, m = (int(month[:4]), int(month[5:7]))
= 0035 | 0037 |     idx = y * 12 + (m - 1) + delta
= 0036 | 0038 |     return f"{idx // 12:04d}-{idx % 12 + 1:02d}"
= 0037 | 0039 | 
= 0038 | 0040 | 
= 0039 | 0041 | def months_between(a: str, b: str) -> int:
= 0040 | 0042 |     """Whole months from month `a` to month `b` (positive when b is after a)."""
- 0041 | ---- |     ya, ma, yb, mb = int(a[:4]), int(a[5:7]), int(b[:4]), int(b[5:7])
- 0042 | ---- |     return (yb * 12 + mb) - (ya * 12 + ma)
+ ---- | 0043 |     ya, ma, yb, mb = (int(a[:4]), int(a[5:7]), int(b[:4]), int(b[5:7]))
+ ---- | 0044 |     return yb * 12 + mb - (ya * 12 + ma)
= 0043 | 0045 | 
= 0044 | 0046 | 
= 0045 | 0047 | def month_portion(tx: dict, month: str) -> float | None:
= 0046 | 0048 |     """Positive amount the transaction contributes to `month`'s income/expense stats.
= 0047 | 0049 | 
= 0048 | 0050 |     Installments spread as one installment_value per month, from the purchase
= 0049 | 0051 |     month to the last installment — so future parcels never double-count in the
= 0050 | 0052 |     current month. Pending/scheduled money and transfers count as zero.
= 0051 | 0053 |     """
- 0052 | ---- |     if tx.get("type") == "transferencia" or tx.get("status") != "pago":
+ ---- | 0054 |     if tx.get("invoice_payment") or tx.get("type") == "transferencia" or tx.get("status") != "pago":
= 0053 | 0055 |         return None
= 0054 | 0056 |     d: str = tx["date"]
= 0055 | 0057 |     if tx.get("installment"):
= 0056 | 0058 |         n = int(tx.get("total_installments") or 1)
= 0057 | 0059 |         offset = months_between(d[:7], month)
= 0058 | 0060 |         if 0 <= offset < n:
- 0059 | ---- |             return round(float(tx.get("installment_value") or 0.0), 2)
+ ---- | 0061 |             return installment_portion(tx, offset)
= 0060 | 0062 |         return None
- 0061 | ---- |     return round(float(tx["value"]), 2) if d[:7] == month else None
+ ---- | 0063 |     return round(D(tx["value"]), 2) if d[:7] == month else None
= 0062 | 0064 | 
= 0063 | 0065 | 
= 0064 | 0066 | def balance_effects(tx: dict, today: str) -> list[tuple[str, float]]:
= 0065 | 0067 |     """Signed effect on each account's balance.
= 0066 | 0068 | 
= 0067 | 0069 |     Status is the single source of truth: "pago" means the money moved, so it
= 0068 | 0070 |     counts regardless of the date; "pendente"/"agendado" never move a balance.
= 0069 | 0071 |     A parcelado purchase counts only the installments already come due.
= 0070 | 0072 |     """
- 0071 | ---- |     if tx.get("status") != "pago":
+ ---- | 0073 |     if tx.get("card_id") or tx.get("status") != "pago":
= 0072 | 0074 |         return []
- 0073 | ---- |     v = float(tx["value"])
+ ---- | 0075 |     v = D(tx["value"])
= 0074 | 0076 |     if tx.get("installment"):
= 0075 | 0077 |         n = int(tx.get("total_installments") or 1)
= 0076 | 0078 |         due = months_between(tx["date"][:7], today[:7]) + 1
- 0077 | ---- |         v = round(float(tx.get("installment_value") or 0.0) * max(0, min(due, n)), 2)
+ ---- | 0079 |         v = sum((installment_portion(tx, i) for i in range(max(0, min(due, n)))), D(0))
= 0078 | 0080 |     if tx["type"] == "receita":
= 0079 | 0081 |         return [(tx["account_id"], round(v, 2))]
= 0080 | 0082 |     if tx["type"] == "despesa":
= 0081 | 0083 |         return [(tx["account_id"], round(-v, 2))]
= 0082 | 0084 |     effects = [(tx["account_id"], round(-v, 2))]
= 0083 | 0085 |     if tx.get("to_account_id") and tx["to_account_id"] != tx["account_id"]:
= 0084 | 0086 |         effects.append((tx["to_account_id"], round(v, 2)))
= 0085 | 0087 |     return effects
= 0086 | 0088 | 
```


## backend/routers/accounts.py ↔ frontend/finnos/routers/accounts.py

Linhas legado 127; ativo 140.

```text
L---- | F---- | código
- 0001 | ---- | """Bank accounts with server-computed balances (money already due up to today)."""
+ ---- | 0001 | from finnos.lib.money import D
= 0002 | 0002 | 
+ ---- | 0003 | """Bank accounts with server-computed balances (money already due up to today)."""
= 0003 | 0004 | import uuid
= 0004 | 0005 | from datetime import datetime, timezone
= 0005 | 0006 | from typing import List
- 0006 | ---- | 
= 0007 | 0007 | from fastapi import APIRouter, Depends, HTTPException, Response
- 0008 | ---- | 
- 0009 | ---- | from lib.db import db
- 0010 | ---- | from lib.dates import today_iso
- 0011 | ---- | from lib.stats import aware, balance_effects
- 0012 | ---- | from models.finnos import AccountDetailOut, AccountIn, AccountOut
- 0013 | ---- | from routers.auth import require_user
- 0014 | ---- | from routers.transactions import _ref_maps, enrich_transaction
+ ---- | 0008 | from finnos.lib.db import db
+ ---- | 0009 | from finnos.lib.dates import today_iso
+ ---- | 0010 | from finnos.lib.stats import aware, balance_effects
+ ---- | 0011 | from finnos.models.finnos import AccountDetailOut, AccountIn, AccountOut
+ ---- | 0012 | from finnos.routers.auth import require_user
+ ---- | 0013 | from finnos.routers.transactions import _ref_maps, enrich_transaction
= 0015 | 0014 | 
= 0016 | 0015 | router = APIRouter(prefix="/accounts", tags=["accounts"])
= 0017 | 0016 | 
= 0018 | 0017 | 
= 0019 | 0018 | async def _enriched_accounts(user_id: str) -> list[AccountOut]:
= 0020 | 0019 |     today = today_iso()
- 0021 | ---- |     accounts = await db.accounts.find({"user_id": user_id}).sort("created_at", 1).to_list(500)
+ ---- | 0020 |     accounts = (
+ ---- | 0021 |         await db.accounts.find({"user_id": user_id}).sort("created_at", 1).to_list(500)
+ ---- | 0022 |     )
= 0022 | 0023 |     txs = await db.transactions.find({"user_id": user_id}).to_list(20000)
- 0023 | ---- | 
- 0024 | ---- |     balance = {a["id"]: float(a.get("initial_balance") or 0.0) for a in accounts}
- 0025 | ---- |     income = {a["id"]: 0.0 for a in accounts}
- 0026 | ---- |     expense = {a["id"]: 0.0 for a in accounts}
+ ---- | 0024 |     balance = {a["id"]: D(a.get("initial_balance") or D("0.0")) for a in accounts}
+ ---- | 0025 |     income = {a["id"]: D("0.0") for a in accounts}
+ ---- | 0026 |     expense = {a["id"]: D("0.0") for a in accounts}
= 0027 | 0027 |     for tx in txs:
= 0028 | 0028 |         for acc_id, amount in balance_effects(tx, today):
- 0029 | ---- |             balance[acc_id] = balance.get(acc_id, 0.0) + amount
+ ---- | 0029 |             balance[acc_id] = balance.get(acc_id, D("0.0")) + amount
= 0030 | 0030 |             if tx.get("type") == "receita":
= 0031 | 0031 |                 income[acc_id] += amount
= 0032 | 0032 |             elif tx.get("type") == "despesa":
= 0033 | 0033 |                 expense[acc_id] -= amount
- 0034 | ---- | 
= 0035 | 0034 |     out = []
= 0036 | 0035 |     for a in accounts:
= 0037 | 0036 |         out.append(
= 0038 | 0037 |             AccountOut(
= 0039 | 0038 |                 id=a["id"],
= 0040 | 0039 |                 name=a["name"],
= 0041 | 0040 |                 institution=a.get("institution", ""),
= 0042 | 0041 |                 type=a.get("type", "corrente"),
= 0043 | 0042 |                 color=a.get("color", "#070F52"),
- 0044 | ---- |                 initial_balance=float(a.get("initial_balance") or 0.0),
+ ---- | 0043 |                 initial_balance=D(a.get("initial_balance") or D("0.0")),
= 0045 | 0044 |                 active=a.get("active", True),
= 0046 | 0045 |                 balance=round(balance[a["id"]], 2),
- 0047 | ---- |                 total_income=round(max(income[a["id"]], 0.0), 2),
- 0048 | ---- |                 total_expense=round(max(expense[a["id"]], 0.0), 2),
+ ---- | 0046 |                 total_income=round(max(income[a["id"]], D("0.0")), 2),
+ ---- | 0047 |                 total_expense=round(max(expense[a["id"]], D("0.0")), 2),
= 0049 | 0048 |                 created_at=aware(a.get("created_at")) or datetime.now(timezone.utc),
= 0050 | 0049 |             )
= 0051 | 0050 |         )
= 0052 | 0051 |     return out
= 0053 | 0052 | 
= 0054 | 0053 | 
= 0055 | 0054 | async def _one_enriched(user_id: str, account_id: str) -> AccountOut | None:
= 0056 | 0055 |     for account in await _enriched_accounts(user_id):
= 0057 | 0056 |         if account.id == account_id:
= 0058 | 0057 |             return account
= 0059 | 0058 |     return None
= 0060 | 0059 | 
= 0061 | 0060 | 
= 0062 | 0061 | @router.get("", response_model=List[AccountOut])
= 0063 | 0062 | async def list_accounts(user: dict = Depends(require_user)) -> list[AccountOut]:
= 0064 | 0063 |     return await _enriched_accounts(user["id"])
= 0065 | 0064 | 
= 0066 | 0065 | 
= 0067 | 0066 | @router.get("/{account_id}", response_model=AccountDetailOut)
- 0068 | ---- | async def get_account(account_id: str, user: dict = Depends(require_user)) -> AccountDetailOut:
+ ---- | 0067 | async def get_account(
+ ---- | 0068 |     account_id: str, user: dict = Depends(require_user)
+ ---- | 0069 | ) -> AccountDetailOut:
= 0069 | 0070 |     account = await _one_enriched(user["id"], account_id)
= 0070 | 0071 |     if not account:
= 0071 | 0072 |         raise HTTPException(status_code=404, detail="Conta não encontrada.")
= 0072 | 0073 |     docs = (
= 0073 | 0074 |         await db.transactions.find(
- 0074 | ---- |             {"user_id": user["id"], "$or": [{"account_id": account_id}, {"to_account_id": account_id}]}
+ ---- | 0075 |             {
+ ---- | 0076 |                 "user_id": user["id"],
+ ---- | 0077 |                 "$or": [{"account_id": account_id}, {"to_account_id": account_id}],
+ ---- | 0078 |             }
= 0075 | 0079 |         )
= 0076 | 0080 |         .sort([("date", -1), ("created_at", -1)])
- 0077 | ---- |         .to_list(8)
+ ---- | 0081 |         .to_list(8, allow_truncate=True)
= 0078 | 0082 |     )
= 0079 | 0083 |     accounts_by_id, categories_by_id = await _ref_maps(user["id"])
- 0080 | ---- |     transactions = [enrich_transaction(d, accounts_by_id, categories_by_id) for d in docs]
+ ---- | 0084 |     transactions = [
+ ---- | 0085 |         enrich_transaction(d, accounts_by_id, categories_by_id) for d in docs
+ ---- | 0086 |     ]
= 0081 | 0087 |     return AccountDetailOut(account=account, transactions=transactions)
= 0082 | 0088 | 
= 0083 | 0089 | 
= 0084 | 0090 | @router.post("", response_model=AccountOut, status_code=201)
- 0085 | ---- | async def create_account(payload: AccountIn, user: dict = Depends(require_user)) -> AccountOut:
+ ---- | 0091 | async def create_account(
+ ---- | 0092 |     payload: AccountIn, user: dict = Depends(require_user)
+ ---- | 0093 | ) -> AccountOut:
= 0086 | 0094 |     doc = {
= 0087 | 0095 |         "id": str(uuid.uuid4()),
= 0088 | 0096 |         "user_id": user["id"],
= 0089 | 0097 |         **payload.model_dump(),
= 0090 | 0098 |         "created_at": datetime.now(timezone.utc),
= 0091 | 0099 |         "updated_at": datetime.now(timezone.utc),
= 0092 | 0100 |     }
= 0093 | 0101 |     await db.accounts.insert_one(doc)
= 0094 | 0102 |     account = await _one_enriched(user["id"], doc["id"])
= 0095 | 0103 |     if not account:
= 0096 | 0104 |         raise HTTPException(status_code=500, detail="Falha ao criar a conta.")
= 0097 | 0105 |     return account
= 0098 | 0106 | 
= 0099 | 0107 | 
= 0100 | 0108 | @router.put("/{account_id}", response_model=AccountOut)
- 0101 | ---- | async def update_account(account_id: str, payload: AccountIn, user: dict = Depends(require_user)) -> AccountOut:
+ ---- | 0109 | async def update_account(
+ ---- | 0110 |     account_id: str, payload: AccountIn, user: dict = Depends(require_user)
+ ---- | 0111 | ) -> AccountOut:
= 0102 | 0112 |     result = await db.accounts.update_one(
= 0103 | 0113 |         {"id": account_id, "user_id": user["id"]},
= 0104 | 0114 |         {"$set": {**payload.model_dump(), "updated_at": datetime.now(timezone.utc)}},
= 0105 | 0115 |     )
= 0106 | 0116 |     if not result.matched_count:
= 0107 | 0117 |         raise HTTPException(status_code=404, detail="Conta não encontrada.")
= 0108 | 0118 |     account = await _one_enriched(user["id"], account_id)
= 0109 | 0119 |     if not account:
= 0110 | 0120 |         raise HTTPException(status_code=404, detail="Conta não encontrada.")
= 0111 | 0121 |     return account
= 0112 | 0122 | 
= 0113 | 0123 | 
= 0114 | 0124 | @router.delete("/{account_id}", status_code=204)
= 0115 | 0125 | async def delete_account(account_id: str, user: dict = Depends(require_user)) -> None:
= 0116 | 0126 |     used = await db.transactions.count_documents(
- 0117 | ---- |         {"user_id": user["id"], "$or": [{"account_id": account_id}, {"to_account_id": account_id}]}
+ ---- | 0127 |         {
+ ---- | 0128 |             "user_id": user["id"],
+ ---- | 0129 |             "$or": [{"account_id": account_id}, {"to_account_id": account_id}],
+ ---- | 0130 |         }
= 0118 | 0131 |     )
= 0119 | 0132 |     if used:
= 0120 | 0133 |         raise HTTPException(
= 0121 | 0134 |             status_code=409,
= 0122 | 0135 |             detail="Esta conta tem transações vinculadas. Exclua ou mova as transações antes de excluir a conta.",
= 0123 | 0136 |         )
= 0124 | 0137 |     result = await db.accounts.delete_one({"id": account_id, "user_id": user["id"]})
= 0125 | 0138 |     if not result.deleted_count:
= 0126 | 0139 |         raise HTTPException(status_code=404, detail="Conta não encontrada.")
= 0127 | 0140 | 
```


## backend/routers/categories.py ↔ frontend/finnos/routers/categories.py

Linhas legado 72; ativo 81.

```text
L---- | F---- | código
- 0001 | ---- | """Categories CRUD — every category belongs to a user and carries its 50/30/20 group."""
+ ---- | 0001 | from finnos.lib.money import D
= 0002 | 0002 | 
+ ---- | 0003 | """Categories CRUD — every category belongs to a user and carries its 50/30/20 group."""
= 0003 | 0004 | import uuid
= 0004 | 0005 | from datetime import datetime, timezone
= 0005 | 0006 | from typing import List
- 0006 | ---- | 
= 0007 | 0007 | from fastapi import APIRouter, Depends, HTTPException, Response
- 0008 | ---- | 
- 0009 | ---- | from lib.db import db
- 0010 | ---- | from lib.stats import aware
- 0011 | ---- | from models.finnos import CategoryIn, CategoryOut
- 0012 | ---- | from routers.auth import require_user
+ ---- | 0008 | from finnos.lib.db import db
+ ---- | 0009 | from finnos.lib.stats import aware
+ ---- | 0010 | from finnos.models.finnos import CategoryIn, CategoryOut
+ ---- | 0011 | from finnos.routers.auth import require_user
= 0013 | 0012 | 
= 0014 | 0013 | router = APIRouter(prefix="/categories", tags=["categories"])
= 0015 | 0014 | 
= 0016 | 0015 | 
= 0017 | 0016 | def _out(doc: dict) -> CategoryOut:
= 0018 | 0017 |     return CategoryOut(
= 0019 | 0018 |         id=doc["id"],
= 0020 | 0019 |         name=doc["name"],
= 0021 | 0020 |         icon=doc.get("icon", "more-horizontal"),
= 0022 | 0021 |         color=doc.get("color", "#64748B"),
= 0023 | 0022 |         group=doc.get("group", "necessidades"),
- 0024 | ---- |         monthly_budget=float(doc.get("monthly_budget") or 0.0),
- 0025 | ---- |         monthly_goal=float(doc.get("monthly_goal") or 0.0),
+ ---- | 0023 |         monthly_budget=D(doc.get("monthly_budget") or D("0.0")),
+ ---- | 0024 |         monthly_goal=D(doc.get("monthly_goal") or D("0.0")),
= 0026 | 0025 |         created_at=aware(doc.get("created_at")) or datetime.now(timezone.utc),
= 0027 | 0026 |     )
= 0028 | 0027 | 
= 0029 | 0028 | 
= 0030 | 0029 | @router.get("", response_model=List[CategoryOut])
= 0031 | 0030 | async def list_categories(user: dict = Depends(require_user)) -> list[CategoryOut]:
- 0032 | ---- |     docs = await db.categories.find({"user_id": user["id"]}).sort("created_at", 1).to_list(500)
+ ---- | 0031 |     docs = (
+ ---- | 0032 |         await db.categories.find({"user_id": user["id"]})
+ ---- | 0033 |         .sort("created_at", 1)
+ ---- | 0034 |         .to_list(500)
+ ---- | 0035 |     )
= 0033 | 0036 |     return [_out(d) for d in docs]
= 0034 | 0037 | 
= 0035 | 0038 | 
= 0036 | 0039 | @router.post("", response_model=CategoryOut, status_code=201)
- 0037 | ---- | async def create_category(payload: CategoryIn, user: dict = Depends(require_user)) -> CategoryOut:
+ ---- | 0040 | async def create_category(
+ ---- | 0041 |     payload: CategoryIn, user: dict = Depends(require_user)
+ ---- | 0042 | ) -> CategoryOut:
= 0038 | 0043 |     doc = {
= 0039 | 0044 |         "id": str(uuid.uuid4()),
= 0040 | 0045 |         "user_id": user["id"],
= 0041 | 0046 |         **payload.model_dump(),
= 0042 | 0047 |         "created_at": datetime.now(timezone.utc),
= 0043 | 0048 |         "updated_at": datetime.now(timezone.utc),
= 0044 | 0049 |     }
= 0045 | 0050 |     await db.categories.insert_one(doc)
= 0046 | 0051 |     return _out(doc)
= 0047 | 0052 | 
= 0048 | 0053 | 
= 0049 | 0054 | @router.put("/{category_id}", response_model=CategoryOut)
- 0050 | ---- | async def update_category(category_id: str, payload: CategoryIn, user: dict = Depends(require_user)) -> CategoryOut:
+ ---- | 0055 | async def update_category(
+ ---- | 0056 |     category_id: str, payload: CategoryIn, user: dict = Depends(require_user)
+ ---- | 0057 | ) -> CategoryOut:
= 0051 | 0058 |     result = await db.categories.update_one(
= 0052 | 0059 |         {"id": category_id, "user_id": user["id"]},
= 0053 | 0060 |         {"$set": {**payload.model_dump(), "updated_at": datetime.now(timezone.utc)}},
= 0054 | 0061 |     )
= 0055 | 0062 |     if not result.matched_count:
= 0056 | 0063 |         raise HTTPException(status_code=404, detail="Categoria não encontrada.")
= 0057 | 0064 |     doc = await db.categories.find_one({"id": category_id, "user_id": user["id"]})
= 0058 | 0065 |     return _out(doc)
= 0059 | 0066 | 
= 0060 | 0067 | 
= 0061 | 0068 | @router.delete("/{category_id}", status_code=204)
= 0062 | 0069 | async def delete_category(category_id: str, user: dict = Depends(require_user)) -> None:
- 0063 | ---- |     used = await db.transactions.count_documents({"user_id": user["id"], "category_id": category_id})
+ ---- | 0070 |     used = await db.transactions.count_documents(
+ ---- | 0071 |         {"user_id": user["id"], "category_id": category_id}
+ ---- | 0072 |     )
= 0064 | 0073 |     if used:
= 0065 | 0074 |         raise HTTPException(
= 0066 | 0075 |             status_code=409,
= 0067 | 0076 |             detail="Esta categoria tem transações vinculadas. Mova-as para outra categoria antes de excluir.",
= 0068 | 0077 |         )
= 0069 | 0078 |     result = await db.categories.delete_one({"id": category_id, "user_id": user["id"]})
= 0070 | 0079 |     if not result.deleted_count:
= 0071 | 0080 |         raise HTTPException(status_code=404, detail="Categoria não encontrada.")
= 0072 | 0081 | 
```
