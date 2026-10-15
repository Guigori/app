# Comparação linha a linha — Home, Fluxo, Análises, notificações e assinaturas

Arquivos `Guigori/app/main` em 14/10/2026. `=` linhas idênticas, `-` código legado, `+` código Firestore/Vercel. A semântica do dinheiro deve ser revisada juntamente com os cálculos em `finno(s)/lib/stats.py`.


## backend/routers/dashboard.py ↔ frontend/finnos/routers/dashboard.py

Linhas legado 116; ativo 120.

```text
L---- | F---- | código
- 0001 | ---- | """Dashboard aggregate: total balance, month stats, category donut, 50/30/20 rule, recent."""
+ ---- | 0001 | from finnos.lib.money import D
= 0002 | 0002 | 
+ ---- | 0003 | """Dashboard aggregate: total balance, month stats, category donut, 50/30/20 rule, recent."""
= 0003 | 0004 | from typing import List, Optional
- 0004 | ---- | 
= 0005 | 0005 | from fastapi import APIRouter, Depends, Query
- 0006 | ---- | 
- 0007 | ---- | from lib.db import db
- 0008 | ---- | from lib.dates import today_iso
- 0009 | ---- | from lib.stats import add_months, balance_effects, month_bounds, month_portion
- 0010 | ---- | from models.finnos import CategorySlice, DashboardOut, RuleItem
- 0011 | ---- | from routers.auth import require_user
- 0012 | ---- | from routers.transactions import _ref_maps, enrich_transaction
+ ---- | 0006 | from finnos.lib.db import db
+ ---- | 0007 | from finnos.lib.dates import today_iso
+ ---- | 0008 | from finnos.lib.stats import add_months, balance_effects, month_bounds, month_portion
+ ---- | 0009 | from finnos.models.finnos import CategorySlice, DashboardOut, RuleItem
+ ---- | 0010 | from finnos.routers.auth import require_user
+ ---- | 0011 | from finnos.routers.transactions import _ref_maps, enrich_transaction
= 0013 | 0012 | 
= 0014 | 0013 | router = APIRouter(prefix="/dashboard", tags=["dashboard"])
- 0015 | ---- | 
- 0016 | ---- | GROUP_LABELS = {"necessidades": "Necessidades", "desejos": "Desejos", "metas": "Metas e investimentos"}
- 0017 | ---- | GROUP_SHARES = {"necessidades": 0.5, "desejos": 0.3, "metas": 0.2}
+ ---- | 0014 | GROUP_LABELS = {
+ ---- | 0015 |     "necessidades": "Necessidades",
+ ---- | 0016 |     "desejos": "Desejos",
+ ---- | 0017 |     "metas": "Metas e investimentos",
+ ---- | 0018 | }
+ ---- | 0019 | GROUP_SHARES = {"necessidades": D("0.5"), "desejos": D("0.3"), "metas": D("0.2")}
= 0018 | 0020 | 
= 0019 | 0021 | 
= 0020 | 0022 | @router.get("", response_model=DashboardOut)
= 0021 | 0023 | async def dashboard(
- 0022 | ---- |     month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
+ ---- | 0024 |     month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
= 0023 | 0025 |     user: dict = Depends(require_user),
= 0024 | 0026 | ) -> DashboardOut:
= 0025 | 0027 |     user_id = user["id"]
= 0026 | 0028 |     today = today_iso()
= 0027 | 0029 |     m = month or today[:7]
= 0028 | 0030 |     prev_month = add_months(m, -1)
- 0029 | ---- | 
= 0030 | 0031 |     accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
= 0031 | 0032 |     categories = await db.categories.find({"user_id": user_id}).to_list(500)
= 0032 | 0033 |     txs = await db.transactions.find({"user_id": user_id}).to_list(20000)
= 0033 | 0034 |     cat_by_id = {c["id"]: c for c in categories}
- 0034 | ---- | 
- 0035 | ---- |     # Saldo total: initial balances + every peso already due up to today.
- 0036 | ---- |     total_balance = sum(float(a.get("initial_balance") or 0.0) for a in accounts)
+ ---- | 0035 |     total_balance = sum((D(a.get("initial_balance") or D("0.0")) for a in accounts))
= 0037 | 0036 |     for tx in txs:
= 0038 | 0037 |         for _acc, amount in balance_effects(tx, today):
= 0039 | 0038 |             total_balance += amount
- 0040 | ---- | 
- 0041 | ---- |     income = expense = 0.0
- 0042 | ---- |     prev_income = prev_expense = 0.0
+ ---- | 0039 |     income = expense = D("0.0")
+ ---- | 0040 |     prev_income = prev_expense = D("0.0")
= 0043 | 0041 |     prev_count = 0
= 0044 | 0042 |     by_category: dict = {}
- 0045 | ---- |     by_group = {"necessidades": 0.0, "desejos": 0.0, "metas": 0.0}
- 0046 | ---- | 
+ ---- | 0043 |     by_group = {"necessidades": D("0.0"), "desejos": D("0.0"), "metas": D("0.0")}
= 0047 | 0044 |     for tx in txs:
= 0048 | 0045 |         portion = month_portion(tx, m)
= 0049 | 0046 |         if portion is not None:
= 0050 | 0047 |             if tx["type"] == "receita":
= 0051 | 0048 |                 income += portion
= 0052 | 0049 |             else:
= 0053 | 0050 |                 expense += portion
= 0054 | 0051 |                 cat = cat_by_id.get(tx.get("category_id"))
= 0055 | 0052 |                 key = cat["id"] if cat else None
- 0056 | ---- |                 by_category[key] = by_category.get(key, 0.0) + portion
+ ---- | 0053 |                 by_category[key] = by_category.get(key, D("0.0")) + portion
= 0057 | 0054 |                 if cat:
= 0058 | 0055 |                     by_group[cat["group"]] += portion
= 0059 | 0056 |         prev_portion = month_portion(tx, prev_month)
= 0060 | 0057 |         if prev_portion is not None:
= 0061 | 0058 |             prev_count += 1
= 0062 | 0059 |             if tx["type"] == "receita":
= 0063 | 0060 |                 prev_income += prev_portion
= 0064 | 0061 |             else:
= 0065 | 0062 |                 prev_expense += prev_portion
- 0066 | ---- | 
= 0067 | 0063 |     income = round(income, 2)
= 0068 | 0064 |     expense = round(expense, 2)
- 0069 | ---- | 
= 0070 | 0065 |     slices = []
= 0071 | 0066 |     for cat_id, total in sorted(by_category.items(), key=lambda kv: -kv[1]):
- 0072 | ---- |         slice_cat = cat_by_id.get(cat_id)  # re-resolved per slice: reusing the loop's `cat` named every slice alike
+ ---- | 0067 |         slice_cat = cat_by_id.get(cat_id)
= 0073 | 0068 |         slices.append(
= 0074 | 0069 |             CategorySlice(
= 0075 | 0070 |                 category_id=cat_id,
= 0076 | 0071 |                 name=slice_cat["name"] if slice_cat else "Sem categoria",
= 0077 | 0072 |                 color=slice_cat["color"] if slice_cat else "#94A3B8",
= 0078 | 0073 |                 icon=slice_cat["icon"] if slice_cat else "more-horizontal",
= 0079 | 0074 |                 total=round(total, 2),
- 0080 | ---- |                 percent=round(total / expense * 100, 1) if expense else 0.0,
+ ---- | 0075 |                 percent=round(total / expense * 100, 1) if expense else D("0.0"),
= 0081 | 0076 |             )
= 0082 | 0077 |         )
- 0083 | ---- | 
= 0084 | 0078 |     rule = []
= 0085 | 0079 |     for key in ("necessidades", "desejos", "metas"):
= 0086 | 0080 |         spent = round(by_group[key], 2)
= 0087 | 0081 |         limit = round(income * GROUP_SHARES[key], 2)
- 0088 | ---- |         percent = round(spent / limit * 100, 1) if limit > 0 else (0.0 if spent == 0 else 101.0)
- 0089 | ---- |         status = "dentro" if percent <= 80 else ("proximo" if percent <= 100 else "acima")
+ ---- | 0082 |         percent = (
+ ---- | 0083 |             round(spent / limit * 100, 1)
+ ---- | 0084 |             if limit > 0
+ ---- | 0085 |             else D("0.0") if spent == 0 else D("101.0")
+ ---- | 0086 |         )
+ ---- | 0087 |         status = "dentro" if percent <= 80 else "proximo" if percent <= 100 else "acima"
= 0090 | 0088 |         rule.append(
- 0091 | ---- |             RuleItem(key=key, label=GROUP_LABELS[key], spent=spent, limit=limit, percent=percent, status=status)
+ ---- | 0089 |             RuleItem(
+ ---- | 0090 |                 key=key,
+ ---- | 0091 |                 label=GROUP_LABELS[key],
+ ---- | 0092 |                 spent=spent,
+ ---- | 0093 |                 limit=limit,
+ ---- | 0094 |                 percent=percent,
+ ---- | 0095 |                 status=status,
+ ---- | 0096 |             )
= 0092 | 0097 |         )
- 0093 | ---- | 
= 0094 | 0098 |     start, end = month_bounds(m)
= 0095 | 0099 |     docs = (
- 0096 | ---- |         await db.transactions.find({"user_id": user_id, "date": {"$gte": start, "$lte": end}})
+ ---- | 0100 |         await db.transactions.find(
+ ---- | 0101 |             {"user_id": user_id, "date": {"$gte": start, "$lte": end}}
+ ---- | 0102 |         )
= 0097 | 0103 |         .sort([("date", -1), ("created_at", -1)])
- 0098 | ---- |         .to_list(6)
+ ---- | 0104 |         .to_list(6, allow_truncate=True)
= 0099 | 0105 |     )
= 0100 | 0106 |     accounts_by_id, categories_by_id = await _ref_maps(user_id)
- 0101 | ---- | 
= 0102 | 0107 |     return DashboardOut(
= 0103 | 0108 |         month=m,
= 0104 | 0109 |         total_balance=round(total_balance, 2),
= 0105 | 0110 |         income=income,
= 0106 | 0111 |         expense=expense,
= 0107 | 0112 |         month_balance=round(income - expense, 2),
- 0108 | ---- |         # No fabricated comparisons: only when the previous month actually had data.
= 0109 | 0113 |         prev_income=round(prev_income, 2) if prev_count else None,
= 0110 | 0114 |         prev_expense=round(prev_expense, 2) if prev_count else None,
- 0111 | ---- |         invested=0.0,  # investments module arrives in a later delivery
+ ---- | 0115 |         invested=D("0.0"),
= 0112 | 0116 |         categories=slices,
= 0113 | 0117 |         rule=rule,
= 0114 | 0118 |         recent=[enrich_transaction(d, accounts_by_id, categories_by_id) for d in docs],
= 0115 | 0119 |     )
= 0116 | 0120 | 
```


## backend/routers/analytics.py ↔ frontend/finnos/routers/analytics.py

Linhas legado 319; ativo 335.

```text
L---- | F---- | código
- 0001 | ---- | """Analytics: month-over-month trends and the monthly budget view."""
+ ---- | 0001 | from finnos.lib.money import D
= 0002 | 0002 | 
+ ---- | 0003 | """Analytics: month-over-month trends and the monthly budget view."""
= 0003 | 0004 | from typing import List, Optional
- 0004 | ---- | 
= 0005 | 0005 | from fastapi import APIRouter, Depends, Query
- 0006 | ---- | 
- 0007 | ---- | from lib.db import db
- 0008 | ---- | from lib.dates import today_iso
- 0009 | ---- | from lib.stats import add_months, month_bounds, month_portion, months_between
- 0010 | ---- | from models.analytics import (
+ ---- | 0006 | from finnos.lib.db import db
+ ---- | 0007 | from finnos.lib.dates import today_iso
+ ---- | 0008 | from finnos.lib.stats import add_months, month_bounds, month_portion, months_between
+ ---- | 0009 | from finnos.models.analytics import (
= 0011 | 0010 |     BudgetRow,
= 0012 | 0011 |     BudgetSummary,
= 0013 | 0012 |     CalendarOut,
= 0014 | 0013 |     DayFlow,
= 0015 | 0014 |     FlowCategory,
= 0016 | 0015 |     FlowOut,
= 0017 | 0016 |     FlowPoint,
= 0018 | 0017 |     MonthTrend,
= 0019 | 0018 |     TrendsOut,
= 0020 | 0019 | )
- 0021 | ---- | from routers.auth import require_user
+ ---- | 0020 | from finnos.routers.auth import require_user
= 0022 | 0021 | 
= 0023 | 0022 | router = APIRouter(prefix="/analytics", tags=["analytics"])
- 0024 | ---- | 
- 0025 | ---- | MONTH_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
+ ---- | 0023 | MONTH_ABBR = [
+ ---- | 0024 |     "jan",
+ ---- | 0025 |     "fev",
+ ---- | 0026 |     "mar",
+ ---- | 0027 |     "abr",
+ ---- | 0028 |     "mai",
+ ---- | 0029 |     "jun",
+ ---- | 0030 |     "jul",
+ ---- | 0031 |     "ago",
+ ---- | 0032 |     "set",
+ ---- | 0033 |     "out",
+ ---- | 0034 |     "nov",
+ ---- | 0035 |     "dez",
+ ---- | 0036 | ]
= 0026 | 0037 | 
= 0027 | 0038 | 
= 0028 | 0039 | def _label(month: str) -> str:
= 0029 | 0040 |     return MONTH_ABBR[int(month[5:7]) - 1]
= 0030 | 0041 | 
= 0031 | 0042 | 
= 0032 | 0043 | @router.get("/trends", response_model=TrendsOut)
= 0033 | 0044 | async def trends(
= 0034 | 0045 |     months: int = Query(default=6, ge=2, le=24),
- 0035 | ---- |     end_month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
+ ---- | 0046 |     end_month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
= 0036 | 0047 |     user: dict = Depends(require_user),
= 0037 | 0048 | ) -> TrendsOut:
= 0038 | 0049 |     """Income/expense/net per month, oldest first — powers the cash-flow table and bars."""
= 0039 | 0050 |     last = end_month or today_iso()[:7]
= 0040 | 0051 |     window = [add_months(last, -i) for i in range(months - 1, -1, -1)]
= 0041 | 0052 |     txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)
- 0042 | ---- | 
= 0043 | 0053 |     rows: list[MonthTrend] = []
= 0044 | 0054 |     for m in window:
- 0045 | ---- |         income = expense = 0.0
+ ---- | 0055 |         income = expense = D("0.0")
= 0046 | 0056 |         for tx in txs:
= 0047 | 0057 |             portion = month_portion(tx, m)
= 0048 | 0058 |             if portion is None:
= 0049 | 0059 |                 continue
= 0050 | 0060 |             if tx["type"] == "receita":
= 0051 | 0061 |                 income += portion
= 0052 | 0062 |             else:
= 0053 | 0063 |                 expense += portion
= 0054 | 0064 |         rows.append(
= 0055 | 0065 |             MonthTrend(
= 0056 | 0066 |                 month=m,
= 0057 | 0067 |                 label=_label(m),
= 0058 | 0068 |                 income=round(income, 2),
= 0059 | 0069 |                 expense=round(expense, 2),
= 0060 | 0070 |                 net=round(income - expense, 2),
= 0061 | 0071 |             )
= 0062 | 0072 |         )
- 0063 | ---- | 
= 0064 | 0073 |     return TrendsOut(
= 0065 | 0074 |         months=rows,
- 0066 | ---- |         total_income=round(sum(r.income for r in rows), 2),
- 0067 | ---- |         total_expense=round(sum(r.expense for r in rows), 2),
+ ---- | 0075 |         total_income=round(sum((r.income for r in rows)), 2),
+ ---- | 0076 |         total_expense=round(sum((r.expense for r in rows)), 2),
= 0068 | 0077 |     )
= 0069 | 0078 | 
= 0070 | 0079 | 
= 0071 | 0080 | @router.get("/budget", response_model=BudgetSummary)
= 0072 | 0081 | async def budget(
- 0073 | ---- |     month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
+ ---- | 0082 |     month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
= 0074 | 0083 |     user: dict = Depends(require_user),
= 0075 | 0084 | ) -> BudgetSummary:
= 0076 | 0085 |     """Planned vs used per category for the month, with status that never relies on colour alone."""
= 0077 | 0086 |     m = month or today_iso()[:7]
- 0078 | ---- |     categories = await db.categories.find({"user_id": user["id"]}).sort("created_at", 1).to_list(500)
+ ---- | 0087 |     categories = (
+ ---- | 0088 |         await db.categories.find({"user_id": user["id"]})
+ ---- | 0089 |         .sort("created_at", 1)
+ ---- | 0090 |         .to_list(500)
+ ---- | 0091 |     )
= 0079 | 0092 |     txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)
- 0080 | ---- | 
= 0081 | 0093 |     spent_by_cat: dict[str | None, float] = {}
- 0082 | ---- |     income = 0.0
+ ---- | 0094 |     income = D("0.0")
= 0083 | 0095 |     for tx in txs:
= 0084 | 0096 |         portion = month_portion(tx, m)
= 0085 | 0097 |         if portion is None:
= 0086 | 0098 |             continue
= 0087 | 0099 |         if tx["type"] == "receita":
= 0088 | 0100 |             income += portion
= 0089 | 0101 |         else:
= 0090 | 0102 |             key = tx.get("category_id")
- 0091 | ---- |             spent_by_cat[key] = spent_by_cat.get(key, 0.0) + portion
- 0092 | ---- | 
+ ---- | 0103 |             spent_by_cat[key] = spent_by_cat.get(key, D("0.0")) + portion
= 0093 | 0104 |     rows: list[BudgetRow] = []
= 0094 | 0105 |     for cat in categories:
- 0095 | ---- |         budget_value = round(float(cat.get("monthly_budget") or 0.0), 2)
- 0096 | ---- |         spent = round(spent_by_cat.get(cat["id"], 0.0), 2)
+ ---- | 0106 |         budget_value = round(D(cat.get("monthly_budget") or D("0.0")), 2)
+ ---- | 0107 |         spent = round(spent_by_cat.get(cat["id"], D("0.0")), 2)
= 0097 | 0108 |         if budget_value <= 0:
= 0098 | 0109 |             status = "sem_limite"
- 0099 | ---- |             percent = 0.0
+ ---- | 0110 |             percent = D("0.0")
= 0100 | 0111 |         else:
= 0101 | 0112 |             percent = round(spent / budget_value * 100, 1)
- 0102 | ---- |             status = "dentro" if percent <= 80 else ("proximo" if percent <= 100 else "acima")
- 0103 | ---- |         # Rows with neither budget nor spending would be noise on the page.
+ ---- | 0113 |             status = (
+ ---- | 0114 |                 "dentro" if percent <= 80 else "proximo" if percent <= 100 else "acima"
+ ---- | 0115 |             )
= 0104 | 0116 |         if budget_value <= 0 and spent <= 0:
= 0105 | 0117 |             continue
= 0106 | 0118 |         rows.append(
= 0107 | 0119 |             BudgetRow(
= 0108 | 0120 |                 category_id=cat["id"],
= 0109 | 0121 |                 name=cat["name"],
= 0110 | 0122 |                 icon=cat.get("icon", "more-horizontal"),
= 0111 | 0123 |                 color=cat.get("color", "#64748B"),
= 0112 | 0124 |                 group=cat.get("group", "necessidades"),
= 0113 | 0125 |                 budget=budget_value,
= 0114 | 0126 |                 spent=spent,
= 0115 | 0127 |                 remaining=round(budget_value - spent, 2),
= 0116 | 0128 |                 percent=percent,
= 0117 | 0129 |                 status=status,
= 0118 | 0130 |             )
= 0119 | 0131 |         )
- 0120 | ---- | 
= 0121 | 0132 |     rows.sort(key=lambda r: (r.budget <= 0, -r.percent, -r.spent))
- 0122 | ---- |     planned = round(sum(r.budget for r in rows), 2)
- 0123 | ---- |     spent_total = round(sum(r.spent for r in rows), 2)
- 0124 | ---- |     budgeted_spent = round(sum(r.spent for r in rows if r.budget > 0), 2)
- 0125 | ---- | 
+ ---- | 0133 |     planned = round(sum((r.budget for r in rows)), 2)
+ ---- | 0134 |     spent_total = round(sum((r.spent for r in rows)), 2)
+ ---- | 0135 |     budgeted_spent = round(sum((r.spent for r in rows if r.budget > 0)), 2)
= 0126 | 0136 |     return BudgetSummary(
= 0127 | 0137 |         month=m,
= 0128 | 0138 |         planned=planned,
= 0129 | 0139 |         spent=spent_total,
= 0130 | 0140 |         remaining=round(planned - budgeted_spent, 2),
- 0131 | ---- |         percent=round(budgeted_spent / planned * 100, 1) if planned else 0.0,
+ ---- | 0141 |         percent=round(budgeted_spent / planned * 100, 1) if planned else D("0.0"),
= 0132 | 0142 |         income=round(income, 2),
= 0133 | 0143 |         unbudgeted_spent=round(spent_total - budgeted_spent, 2),
= 0134 | 0144 |         rows=rows,
= 0135 | 0145 |     )
= 0136 | 0146 | 
= 0137 | 0147 | 
- 0138 | ---- | # --- Fluxo -------------------------------------------------------------------
- 0139 | ---- | 
- 0140 | ---- | 
= 0141 | 0148 | def _amount(tx: dict) -> float:
= 0142 | 0149 |     """What a single occurrence of the transaction is worth."""
= 0143 | 0150 |     if tx.get("installment"):
- 0144 | ---- |         return round(float(tx.get("installment_value") or 0.0), 2)
- 0145 | ---- |     return round(float(tx["value"]), 2)
+ ---- | 0151 |         return round(D(tx.get("installment_value") or D("0.0")), 2)
+ ---- | 0152 |     return round(D(tx["value"]), 2)
= 0146 | 0153 | 
= 0147 | 0154 | 
= 0148 | 0155 | def _projection(tx: dict, month: str, settled_keys: set) -> float | None:
= 0149 | 0156 |     """Money still expected in `month`: pending/scheduled entries on their own month,
= 0150 | 0157 |     plus "fixa mensal" entries repeating into later months (skipped when a real
= 0151 | 0158 |     transaction with the same name already exists in that month, so nothing doubles)."""
= 0152 | 0159 |     if tx.get("type") == "transferencia":
= 0153 | 0160 |         return None
= 0154 | 0161 |     tx_month = tx["date"][:7]
= 0155 | 0162 |     if tx.get("status") != "pago" and tx_month == month:
= 0156 | 0163 |         return _amount(tx)
= 0157 | 0164 |     if tx.get("fixed") and (tx.get("recurrence") or "mensal") == "mensal":
- 0158 | ---- |         if months_between(tx_month, month) > 0 and (tx["name"].strip().lower(), month) not in settled_keys:
+ ---- | 0165 |         if (
+ ---- | 0166 |             months_between(tx_month, month) > 0
+ ---- | 0167 |             and (tx["name"].strip().lower(), month) not in settled_keys
+ ---- | 0168 |         ):
= 0159 | 0169 |             return _amount(tx)
= 0160 | 0170 |     return None
= 0161 | 0171 | 
= 0162 | 0172 | 
= 0163 | 0173 | @router.get("/flow", response_model=FlowOut)
= 0164 | 0174 | async def flow(
- 0165 | ---- |     month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
+ ---- | 0175 |     month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
= 0166 | 0176 |     months: int = Query(default=12, ge=2, le=24),
- 0167 | ---- |     from_month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
- 0168 | ---- |     to_month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
+ ---- | 0177 |     from_month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
+ ---- | 0178 |     to_month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
= 0169 | 0179 |     category_id: Optional[str] = Query(default=None),
= 0170 | 0180 |     user: dict = Depends(require_user),
= 0171 | 0181 | ) -> FlowOut:
= 0172 | 0182 |     """Cash flow for a period: realised income/expense per month, the projection for the
= 0173 | 0183 |     months ahead and where the money went in the focus month.
= 0174 | 0184 | 
= 0175 | 0185 |     Window: `from_month`/`to_month` when both are given (período personalizado), else the
= 0176 | 0186 |     last `months` months ending on the focus month plus two months of projection.
= 0177 | 0187 |     """
= 0178 | 0188 |     focus = month or today_iso()[:7]
= 0179 | 0189 |     if from_month and to_month:
- 0180 | ---- |         start, end = (from_month, to_month) if from_month <= to_month else (to_month, from_month)
+ ---- | 0190 |         start, end = (
+ ---- | 0191 |             (from_month, to_month) if from_month <= to_month else (to_month, from_month)
+ ---- | 0192 |         )
= 0181 | 0193 |         span = min(months_between(start, end), 35)
= 0182 | 0194 |         window = [add_months(start, i) for i in range(span + 1)]
= 0183 | 0195 |     else:
= 0184 | 0196 |         window = [add_months(focus, -i) for i in range(months - 1, -1, -1)]
= 0185 | 0197 |         window += [add_months(focus, 1), add_months(focus, 2)]
- 0186 | ---- | 
= 0187 | 0198 |     txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)
= 0188 | 0199 |     if category_id:
= 0189 | 0200 |         txs = [tx for tx in txs if tx.get("category_id") == category_id]
= 0190 | 0201 |     categories = await db.categories.find({"user_id": user["id"]}).to_list(500)
= 0191 | 0202 |     cat_by_id = {c["id"]: c for c in categories}
- 0192 | ---- | 
= 0193 | 0203 |     settled_keys = {(tx["name"].strip().lower(), tx["date"][:7]) for tx in txs}
= 0194 | 0204 |     today_month = today_iso()[:7]
- 0195 | ---- | 
= 0196 | 0205 |     series: list[FlowPoint] = []
= 0197 | 0206 |     for m in window:
- 0198 | ---- |         income = expense = p_income = p_expense = 0.0
+ ---- | 0207 |         income = expense = p_income = p_expense = D("0.0")
= 0199 | 0208 |         for tx in txs:
= 0200 | 0209 |             portion = month_portion(tx, m)
= 0201 | 0210 |             if portion is not None:
= 0202 | 0211 |                 if tx["type"] == "receita":
= 0203 | 0212 |                     income += portion
= 0204 | 0213 |                 else:
= 0205 | 0214 |                     expense += portion
= 0206 | 0215 |             projected = _projection(tx, m, settled_keys)
= 0207 | 0216 |             if projected is not None:
= 0208 | 0217 |                 if tx["type"] == "receita":
= 0209 | 0218 |                     p_income += projected
= 0210 | 0219 |                 else:
= 0211 | 0220 |                     p_expense += projected
= 0212 | 0221 |         series.append(
= 0213 | 0222 |             FlowPoint(
= 0214 | 0223 |                 month=m,
= 0215 | 0224 |                 label=_label(m),
= 0216 | 0225 |                 year=f"'{m[2:4]}",
= 0217 | 0226 |                 income=round(income, 2),
= 0218 | 0227 |                 expense=round(expense, 2),
= 0219 | 0228 |                 net=round(income - expense, 2),
= 0220 | 0229 |                 projected_income=round(p_income, 2),
= 0221 | 0230 |                 projected_expense=round(p_expense, 2),
= 0222 | 0231 |                 projected_net=round(p_income - p_expense, 2),
= 0223 | 0232 |                 future=m > today_month,
= 0224 | 0233 |             )
= 0225 | 0234 |         )
- 0226 | ---- | 
- 0227 | ---- |     # "Onde foi o dinheiro" — expenses of the focus month by category.
= 0228 | 0235 |     by_cat: dict[str | None, float] = {}
= 0229 | 0236 |     for tx in txs:
= 0230 | 0237 |         portion = month_portion(tx, focus)
= 0231 | 0238 |         if portion is None or tx["type"] == "receita":
= 0232 | 0239 |             continue
= 0233 | 0240 |         key = tx.get("category_id")
- 0234 | ---- |         by_cat[key] = by_cat.get(key, 0.0) + portion
+ ---- | 0241 |         by_cat[key] = by_cat.get(key, D("0.0")) + portion
= 0235 | 0242 |     focus_expense = round(sum(by_cat.values()), 2)
= 0236 | 0243 |     breakdown = [
= 0237 | 0244 |         FlowCategory(
= 0238 | 0245 |             category_id=key,
- 0239 | ---- |             name=cat_by_id.get(key, {}).get("name", "Sem categoria") if key else "Sem categoria",
+ ---- | 0246 |             name=(
+ ---- | 0247 |                 cat_by_id.get(key, {}).get("name", "Sem categoria")
+ ---- | 0248 |                 if key
+ ---- | 0249 |                 else "Sem categoria"
+ ---- | 0250 |             ),
= 0240 | 0251 |             color=cat_by_id.get(key, {}).get("color", "#94A3B8") if key else "#94A3B8",
- 0241 | ---- |             icon=cat_by_id.get(key, {}).get("icon", "more-horizontal") if key else "more-horizontal",
+ ---- | 0252 |             icon=(
+ ---- | 0253 |                 cat_by_id.get(key, {}).get("icon", "more-horizontal")
+ ---- | 0254 |                 if key
+ ---- | 0255 |                 else "more-horizontal"
+ ---- | 0256 |             ),
= 0242 | 0257 |             total=round(value, 2),
- 0243 | ---- |             percent=round(value / focus_expense * 100, 1) if focus_expense else 0.0,
+ ---- | 0258 |             percent=(
+ ---- | 0259 |                 round(value / focus_expense * 100, 1) if focus_expense else D("0.0")
+ ---- | 0260 |             ),
= 0244 | 0261 |         )
= 0245 | 0262 |         for key, value in sorted(by_cat.items(), key=lambda kv: -kv[1])
= 0246 | 0263 |     ]
- 0247 | ---- | 
= 0248 | 0264 |     point = next((p for p in series if p.month == focus), None)
= 0249 | 0265 |     return FlowOut(
= 0250 | 0266 |         month=focus,
= 0251 | 0267 |         from_month=window[0],
= 0252 | 0268 |         to_month=window[-1],
- 0253 | ---- |         income=point.income if point else 0.0,
- 0254 | ---- |         expense=point.expense if point else 0.0,
- 0255 | ---- |         net=point.net if point else 0.0,
- 0256 | ---- |         projected_income=point.projected_income if point else 0.0,
- 0257 | ---- |         projected_expense=point.projected_expense if point else 0.0,
- 0258 | ---- |         projected_net=point.projected_net if point else 0.0,
- 0259 | ---- |         total_income=round(sum(p.income for p in series), 2),
- 0260 | ---- |         total_expense=round(sum(p.expense for p in series), 2),
- 0261 | ---- |         total_net=round(sum(p.net for p in series), 2),
+ ---- | 0269 |         income=point.income if point else D("0.0"),
+ ---- | 0270 |         expense=point.expense if point else D("0.0"),
+ ---- | 0271 |         net=point.net if point else D("0.0"),
+ ---- | 0272 |         projected_income=point.projected_income if point else D("0.0"),
+ ---- | 0273 |         projected_expense=point.projected_expense if point else D("0.0"),
+ ---- | 0274 |         projected_net=point.projected_net if point else D("0.0"),
+ ---- | 0275 |         total_income=round(sum((p.income for p in series)), 2),
+ ---- | 0276 |         total_expense=round(sum((p.expense for p in series)), 2),
+ ---- | 0277 |         total_net=round(sum((p.net for p in series)), 2),
= 0262 | 0278 |         series=series,
= 0263 | 0279 |         categories=breakdown,
= 0264 | 0280 |     )
= 0265 | 0281 | 
= 0266 | 0282 | 
- 0267 | ---- | # --- Calendário --------------------------------------------------------------
- 0268 | ---- | 
- 0269 | ---- | 
= 0270 | 0283 | @router.get("/calendar", response_model=CalendarOut)
= 0271 | 0284 | async def calendar_month(
- 0272 | ---- |     month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
+ ---- | 0285 |     month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
= 0273 | 0286 |     user: dict = Depends(require_user),
= 0274 | 0287 | ) -> CalendarOut:
= 0275 | 0288 |     """Per-day entradas/saídas of the month, plus what is still only expected."""
= 0276 | 0289 |     m = month or today_iso()[:7]
= 0277 | 0290 |     start, end = month_bounds(m)
= 0278 | 0291 |     txs = await db.transactions.find(
= 0279 | 0292 |         {"user_id": user["id"], "date": {"$gte": start, "$lte": end}}
= 0280 | 0293 |     ).to_list(5000)
- 0281 | ---- | 
= 0282 | 0294 |     buckets: dict[str, DayFlow] = {}
= 0283 | 0295 |     for tx in txs:
= 0284 | 0296 |         day = buckets.setdefault(
= 0285 | 0297 |             tx["date"],
- 0286 | ---- |             DayFlow(date=tx["date"], income=0.0, expense=0.0, projected_income=0.0, projected_expense=0.0, count=0),
+ ---- | 0298 |             DayFlow(
+ ---- | 0299 |                 date=tx["date"],
+ ---- | 0300 |                 income=D("0.0"),
+ ---- | 0301 |                 expense=D("0.0"),
+ ---- | 0302 |                 projected_income=D("0.0"),
+ ---- | 0303 |                 projected_expense=D("0.0"),
+ ---- | 0304 |                 count=0,
+ ---- | 0305 |             ),
= 0287 | 0306 |         )
= 0288 | 0307 |         day.count += 1
= 0289 | 0308 |         if tx["type"] == "transferencia":
= 0290 | 0309 |             continue
= 0291 | 0310 |         value = _amount(tx)
= 0292 | 0311 |         if tx.get("status") == "pago":
= 0293 | 0312 |             if tx["type"] == "receita":
- 0294 | ---- |                 day.income = round(day.income + value, 2)
+ ---- | 0313 |                 day.income = round(D(day.income) + value, 2)
= 0295 | 0314 |             else:
- 0296 | ---- |                 day.expense = round(day.expense + value, 2)
+ ---- | 0315 |                 day.expense = round(D(day.expense) + value, 2)
+ ---- | 0316 |         elif tx["type"] == "receita":
+ ---- | 0317 |             day.projected_income = round(D(day.projected_income) + value, 2)
= 0297 | 0318 |         else:
- 0298 | ---- |             if tx["type"] == "receita":
- 0299 | ---- |                 day.projected_income = round(day.projected_income + value, 2)
- 0300 | ---- |             else:
- 0301 | ---- |                 day.projected_expense = round(day.projected_expense + value, 2)
- 0302 | ---- | 
+ ---- | 0319 |             day.projected_expense = round(D(day.projected_expense) + value, 2)
= 0303 | 0320 |     days = sorted(buckets.values(), key=lambda d: d.date)
- 0304 | ---- |     income = round(sum(d.income for d in days), 2)
- 0305 | ---- |     expense = round(sum(d.expense for d in days), 2)
- 0306 | ---- |     p_income = round(sum(d.projected_income for d in days), 2)
- 0307 | ---- |     p_expense = round(sum(d.projected_expense for d in days), 2)
- 0308 | ---- | 
+ ---- | 0321 |     income = round(sum((d.income for d in days)), 2)
+ ---- | 0322 |     expense = round(sum((d.expense for d in days)), 2)
+ ---- | 0323 |     p_income = round(sum((d.projected_income for d in days)), 2)
+ ---- | 0324 |     p_expense = round(sum((d.projected_expense for d in days)), 2)
= 0309 | 0325 |     return CalendarOut(
= 0310 | 0326 |         month=m,
= 0311 | 0327 |         days=days,
= 0312 | 0328 |         income=income,
= 0313 | 0329 |         expense=expense,
= 0314 | 0330 |         net=round(income - expense, 2),
= 0315 | 0331 |         projected_income=p_income,
= 0316 | 0332 |         projected_expense=p_expense,
= 0317 | 0333 |         projected_balance=round(income - expense + p_income - p_expense, 2),
= 0318 | 0334 |     )
= 0319 | 0335 | 
```


## backend/routers/notifications.py ↔ frontend/finnos/routers/notifications.py

Linhas legado 155; ativo 162.

```text
L---- | F---- | código
- 0001 | ---- | """Notifications: scheduled/pending money coming due, and card invoices closing in."""
+ ---- | 0001 | from finnos.lib.money import D
= 0002 | 0002 | 
+ ---- | 0003 | """Notifications: scheduled/pending money coming due, and card invoices closing in."""
= 0003 | 0004 | from datetime import date
- 0004 | ---- | 
= 0005 | 0005 | from fastapi import APIRouter, Depends, Query
- 0006 | ---- | 
- 0007 | ---- | from lib.cards import cycle_bounds, due_date
- 0008 | ---- | from lib.db import db
- 0009 | ---- | from lib.dates import today_iso
- 0010 | ---- | from models.cards import NotificationItem, NotificationsOut
- 0011 | ---- | from routers.auth import require_user
+ ---- | 0006 | from finnos.lib.cards import cycle_bounds, due_date
+ ---- | 0007 | from finnos.lib.db import db
+ ---- | 0008 | from finnos.lib.dates import today_iso
+ ---- | 0009 | from finnos.models.cards import NotificationItem, NotificationsOut
+ ---- | 0010 | from finnos.routers.auth import require_user
= 0012 | 0011 | 
= 0013 | 0012 | router = APIRouter(prefix="/notifications", tags=["notifications"])
- 0014 | ---- | 
= 0015 | 0013 | TYPE_WORD = {"receita": "Receita", "despesa": "Conta", "transferencia": "Transferência"}
= 0016 | 0014 | 
= 0017 | 0015 | 
= 0018 | 0016 | @router.get("", response_model=NotificationsOut)
= 0019 | 0017 | async def notifications(
- 0020 | ---- |     window_days: int = Query(default=7, ge=1, le=60),
- 0021 | ---- |     user: dict = Depends(require_user),
+ ---- | 0018 |     window_days: int = Query(default=7, ge=1, le=60), user: dict = Depends(require_user)
= 0022 | 0019 | ) -> NotificationsOut:
= 0023 | 0020 |     """Everything that needs attention: overdue entries and anything due within the window."""
= 0024 | 0021 |     today = date.fromisoformat(today_iso())
= 0025 | 0022 |     limit = today.toordinal() + window_days
- 0026 | ---- | 
= 0027 | 0023 |     txs = await db.transactions.find(
= 0028 | 0024 |         {"user_id": user["id"], "status": {"$in": ["agendado", "pendente"]}}
= 0029 | 0025 |     ).to_list(5000)
- 0030 | ---- | 
- 0031 | ---- |     dismissed_docs = await db.notification_states.find({"user_id": user["id"], "dismissed": True}).to_list(5000)
+ ---- | 0026 |     dismissed_docs = await db.notification_states.find(
+ ---- | 0027 |         {"user_id": user["id"], "dismissed": True}
+ ---- | 0028 |     ).to_list(5000)
= 0032 | 0029 |     dismissed = {doc["notification_id"] for doc in dismissed_docs}
- 0033 | ---- | 
- 0034 | ---- |     dismissed_docs = await db.notification_states.find({"user_id": user["id"], "dismissed": True}).to_list(5000)
+ ---- | 0030 |     dismissed_docs = await db.notification_states.find(
+ ---- | 0031 |         {"user_id": user["id"], "dismissed": True}
+ ---- | 0032 |     ).to_list(5000)
= 0035 | 0033 |     dismissed = {doc["notification_id"] for doc in dismissed_docs}
- 0036 | ---- | 
= 0037 | 0034 |     items: list[NotificationItem] = []
= 0038 | 0035 |     for tx in txs:
= 0039 | 0036 |         if tx.get("notify_enabled", True) is False:
= 0040 | 0037 |             continue
= 0041 | 0038 |         due = date.fromisoformat(tx["date"])
= 0042 | 0039 |         days_left = due.toordinal() - today.toordinal()
= 0043 | 0040 |         if days_left > window_days:
= 0044 | 0041 |             continue
= 0045 | 0042 |         overdue = days_left < 0
= 0046 | 0043 |         word = TYPE_WORD.get(tx["type"], "Lançamento")
= 0047 | 0044 |         if overdue:
= 0048 | 0045 |             description = f"Venceu há {abs(days_left)} dia(s) e continua em aberto."
= 0049 | 0046 |         elif days_left == 0:
= 0050 | 0047 |             description = "Vence hoje."
= 0051 | 0048 |         else:
= 0052 | 0049 |             description = f"Vence em {days_left} dia(s)."
= 0053 | 0050 |         notification_id = f"tx-{tx['id']}-{tx['date']}"
= 0054 | 0051 |         if notification_id in dismissed:
= 0055 | 0052 |             continue
= 0056 | 0053 |         items.append(
= 0057 | 0054 |             NotificationItem(
= 0058 | 0055 |                 id=notification_id,
= 0059 | 0056 |                 kind="atrasado" if overdue else "vencimento",
= 0060 | 0057 |                 title=f"{word}: {tx['name']}",
= 0061 | 0058 |                 description=description,
= 0062 | 0059 |                 date=tx["date"],
- 0063 | ---- |                 value=round(float(tx["value"]), 2),
+ ---- | 0060 |                 value=round(D(tx["value"]), 2),
= 0064 | 0061 |                 days_left=days_left,
= 0065 | 0062 |                 target_url=f"/transacoes?date={tx['date']}&highlight={tx['id']}",
= 0066 | 0063 |             )
= 0067 | 0064 |         )
- 0068 | ---- | 
= 0069 | 0065 |     cards = await db.cards.find({"user_id": user["id"], "active": True}).to_list(200)
= 0070 | 0066 |     for card in cards:
= 0071 | 0067 |         _, closing = cycle_bounds(today, card["closing_day"])
= 0072 | 0068 |         due = due_date(closing, card["closing_day"], card["due_day"])
= 0073 | 0069 |         days_left = due.toordinal() - today.toordinal()
= 0074 | 0070 |         if due.toordinal() > limit:
= 0075 | 0071 |             continue
= 0076 | 0072 |         notification_id = f"card-{card['id']}-{due.isoformat()}"
= 0077 | 0073 |         if notification_id in dismissed:
= 0078 | 0074 |             continue
= 0079 | 0075 |         items.append(
= 0080 | 0076 |             NotificationItem(
= 0081 | 0077 |                 id=notification_id,
= 0082 | 0078 |                 kind="fatura",
= 0083 | 0079 |                 title=f"Fatura {card['name']}",
= 0084 | 0080 |                 description=f"Fecha em {closing.strftime('%d/%m')} e vence em {due.strftime('%d/%m')}.",
= 0085 | 0081 |                 date=due.isoformat(),
- 0086 | ---- |                 value=0.0,
+ ---- | 0082 |                 value=D("0.0"),
= 0087 | 0083 |                 days_left=days_left,
= 0088 | 0084 |                 target_url=f"/cartoes/{card['id']}?due={due.isoformat()}",
= 0089 | 0085 |             )
= 0090 | 0086 |         )
- 0091 | ---- | 
= 0092 | 0087 |     items.sort(key=lambda item: (item.days_left, item.title))
= 0093 | 0088 |     return NotificationsOut(items=items, count=len(items))
= 0094 | 0089 | 
= 0095 | 0090 | 
= 0096 | 0091 | @router.post("/{notification_id}/dismiss")
- 0097 | ---- | async def dismiss_notification(notification_id: str, user: dict = Depends(require_user)) -> dict:
+ ---- | 0092 | async def dismiss_notification(
+ ---- | 0093 |     notification_id: str, user: dict = Depends(require_user)
+ ---- | 0094 | ) -> dict:
= 0098 | 0095 |     """Hide one notification from the user's central without changing the underlying financial record."""
= 0099 | 0096 |     await db.notification_states.update_one(
= 0100 | 0097 |         {"user_id": user["id"], "notification_id": notification_id},
= 0101 | 0098 |         {"$set": {"dismissed": True}},
= 0102 | 0099 |         upsert=True,
= 0103 | 0100 |     )
= 0104 | 0101 |     return {"ok": True}
= 0105 | 0102 | 
= 0106 | 0103 | 
= 0107 | 0104 | @router.post("/clear")
- 0108 | ---- | async def clear_notifications(payload: dict, user: dict = Depends(require_user)) -> dict:
+ ---- | 0105 | async def clear_notifications(
+ ---- | 0106 |     payload: dict, user: dict = Depends(require_user)
+ ---- | 0107 | ) -> dict:
= 0109 | 0108 |     """Dismiss the notification IDs currently visible in the central."""
= 0110 | 0109 |     ids = [str(item) for item in payload.get("ids", []) if str(item).strip()]
= 0111 | 0110 |     if ids:
= 0112 | 0111 |         await db.notification_states.update_many(
= 0113 | 0112 |             {"user_id": user["id"], "notification_id": {"$in": ids}},
= 0114 | 0113 |             {"$set": {"dismissed": True}},
= 0115 | 0114 |             upsert=False,
= 0116 | 0115 |         )
= 0117 | 0116 |         existing = {
= 0118 | 0117 |             doc["notification_id"]
= 0119 | 0118 |             for doc in await db.notification_states.find(
= 0120 | 0119 |                 {"user_id": user["id"], "notification_id": {"$in": ids}}
= 0121 | 0120 |             ).to_list(len(ids))
= 0122 | 0121 |         }
= 0123 | 0122 |         missing = [
- 0124 | ---- |             {"user_id": user["id"], "notification_id": notification_id, "dismissed": True}
+ ---- | 0123 |             {
+ ---- | 0124 |                 "user_id": user["id"],
+ ---- | 0125 |                 "notification_id": notification_id,
+ ---- | 0126 |                 "dismissed": True,
+ ---- | 0127 |             }
= 0125 | 0128 |             for notification_id in ids
= 0126 | 0129 |             if notification_id not in existing
= 0127 | 0130 |         ]
= 0128 | 0131 |         if missing:
= 0129 | 0132 |             await db.notification_states.insert_many(missing)
= 0130 | 0133 |     return {"ok": True, "count": len(ids)}
= 0131 | 0134 | 
= 0132 | 0135 | 
= 0133 | 0136 | @router.post("/{notification_id}/dismiss")
- 0134 | ---- | async def dismiss_notification(notification_id: str, user: dict = Depends(require_user)) -> dict:
+ ---- | 0137 | async def dismiss_notification(
+ ---- | 0138 |     notification_id: str, user: dict = Depends(require_user)
+ ---- | 0139 | ) -> dict:
= 0135 | 0140 |     """Hide one notification from the user's central without changing the underlying financial record."""
= 0136 | 0141 |     await db.notification_states.update_one(
= 0137 | 0142 |         {"user_id": user["id"], "notification_id": notification_id},
= 0138 | 0143 |         {"$set": {"dismissed": True}},
= 0139 | 0144 |         upsert=True,
= 0140 | 0145 |     )
= 0141 | 0146 |     return {"ok": True}
= 0142 | 0147 | 
= 0143 | 0148 | 
= 0144 | 0149 | @router.post("/clear")
- 0145 | ---- | async def clear_notifications(payload: dict, user: dict = Depends(require_user)) -> dict:
+ ---- | 0150 | async def clear_notifications(
+ ---- | 0151 |     payload: dict, user: dict = Depends(require_user)
+ ---- | 0152 | ) -> dict:
= 0146 | 0153 |     """Dismiss the notification IDs currently visible in the central."""
= 0147 | 0154 |     ids = [str(item) for item in payload.get("ids", []) if str(item).strip()]
= 0148 | 0155 |     for notification_id in ids:
= 0149 | 0156 |         await db.notification_states.update_one(
= 0150 | 0157 |             {"user_id": user["id"], "notification_id": notification_id},
= 0151 | 0158 |             {"$set": {"dismissed": True}},
= 0152 | 0159 |             upsert=True,
= 0153 | 0160 |         )
= 0154 | 0161 |     return {"ok": True, "count": len(ids)}
= 0155 | 0162 | 
```


## backend/routers/subscriptions.py ↔ frontend/finnos/routers/subscriptions.py

Linhas legado 76; ativo 83.

```text
L---- | F---- | código
+ ---- | 0001 | from finnos.lib.money import D
+ ---- | 0002 | 
= 0001 | 0003 | """Assinaturas: derived from the user's fixed monthly expenses — no separate entity, so
= 0002 | 0004 | nothing here can drift from the transactions the user actually registered."""
- 0003 | ---- | 
= 0004 | 0005 | from datetime import date
= 0005 | 0006 | from typing import List
- 0006 | ---- | 
= 0007 | 0007 | from fastapi import APIRouter, Depends
- 0008 | ---- | 
- 0009 | ---- | from lib.cards import _clamp_day  # same day-clamping rule as the card cycles
- 0010 | ---- | from lib.db import db
- 0011 | ---- | from lib.dates import today_iso
- 0012 | ---- | from models.notify import SubscriptionItem, SubscriptionsOut
- 0013 | ---- | from routers.auth import require_user
+ ---- | 0008 | from finnos.lib.cards import _clamp_day
+ ---- | 0009 | from finnos.lib.db import db
+ ---- | 0010 | from finnos.lib.dates import today_iso
+ ---- | 0011 | from finnos.models.notify import SubscriptionItem, SubscriptionsOut
+ ---- | 0012 | from finnos.routers.auth import require_user
= 0014 | 0013 | 
= 0015 | 0014 | router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])
= 0016 | 0015 | 
= 0017 | 0016 | 
= 0018 | 0017 | def _next_charge(day: int, today: date) -> str:
= 0019 | 0018 |     """Next occurrence of a monthly charge that happens on `day`."""
= 0020 | 0019 |     this_month = _clamp_day(today.year, today.month, day)
= 0021 | 0020 |     if this_month >= today:
= 0022 | 0021 |         return this_month.isoformat()
- 0023 | ---- |     year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
+ ---- | 0022 |     year, month = (
+ ---- | 0023 |         (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
+ ---- | 0024 |     )
= 0024 | 0025 |     return _clamp_day(year, month, day).isoformat()
= 0025 | 0026 | 
= 0026 | 0027 | 
= 0027 | 0028 | @router.get("", response_model=SubscriptionsOut)
= 0028 | 0029 | async def list_subscriptions(user: dict = Depends(require_user)) -> SubscriptionsOut:
= 0029 | 0030 |     today = date.fromisoformat(today_iso())
- 0030 | ---- |     txs = await db.transactions.find(
- 0031 | ---- |         {"user_id": user["id"], "type": "despesa", "fixed": True}
- 0032 | ---- |     ).sort("date", -1).to_list(2000)
- 0033 | ---- |     accounts = {a["id"]: a for a in await db.accounts.find({"user_id": user["id"]}).to_list(500)}
- 0034 | ---- |     categories = {c["id"]: c for c in await db.categories.find({"user_id": user["id"]}).to_list(500)}
- 0035 | ---- |     cards = {c["id"]: c for c in await db.cards.find({"user_id": user["id"]}).to_list(200)}
- 0036 | ---- | 
- 0037 | ---- |     # One entry per recurring name: the most recent occurrence defines the current price.
+ ---- | 0031 |     txs = (
+ ---- | 0032 |         await db.transactions.find(
+ ---- | 0033 |             {"user_id": user["id"], "type": "despesa", "fixed": True}
+ ---- | 0034 |         )
+ ---- | 0035 |         .sort("date", -1)
+ ---- | 0036 |         .to_list(2000)
+ ---- | 0037 |     )
+ ---- | 0038 |     accounts = {
+ ---- | 0039 |         a["id"]: a for a in await db.accounts.find({"user_id": user["id"]}).to_list(500)
+ ---- | 0040 |     }
+ ---- | 0041 |     categories = {
+ ---- | 0042 |         c["id"]: c
+ ---- | 0043 |         for c in await db.categories.find({"user_id": user["id"]}).to_list(500)
+ ---- | 0044 |     }
+ ---- | 0045 |     cards = {
+ ---- | 0046 |         c["id"]: c for c in await db.cards.find({"user_id": user["id"]}).to_list(200)
+ ---- | 0047 |     }
= 0038 | 0048 |     seen: dict[str, SubscriptionItem] = {}
= 0039 | 0049 |     for tx in txs:
= 0040 | 0050 |         key = tx["name"].strip().lower()
= 0041 | 0051 |         if key in seen:
= 0042 | 0052 |             continue
= 0043 | 0053 |         category = categories.get(tx.get("category_id") or "", {})
= 0044 | 0054 |         card = cards.get(tx.get("card_id") or "", {})
= 0045 | 0055 |         seen[key] = SubscriptionItem(
= 0046 | 0056 |             id=tx["id"],
= 0047 | 0057 |             name=tx["name"],
- 0048 | ---- |             value=round(float(tx["value"]), 2),
+ ---- | 0058 |             value=round(D(tx["value"]), 2),
= 0049 | 0059 |             category_id=tx.get("category_id"),
= 0050 | 0060 |             category_name=category.get("name"),
= 0051 | 0061 |             category_color=category.get("color"),
= 0052 | 0062 |             account_id=tx["account_id"],
= 0053 | 0063 |             account_name=accounts.get(tx["account_id"], {}).get("name", ""),
= 0054 | 0064 |             card_id=tx.get("card_id"),
= 0055 | 0065 |             card_name=card.get("name"),
= 0056 | 0066 |             recurrence=tx.get("recurrence") or "mensal",
= 0057 | 0067 |             next_charge=_next_charge(int(tx["date"][8:10]), today),
= 0058 | 0068 |             active=True,
= 0059 | 0069 |         )
- 0060 | ---- | 
= 0061 | 0070 |     items = sorted(seen.values(), key=lambda i: -i.value)
- 0062 | ---- |     monthly = round(sum(i.value for i in items), 2)
- 0063 | ---- | 
+ ---- | 0071 |     monthly = round(sum((i.value for i in items)), 2)
= 0064 | 0072 |     month = today_iso()[:7]
= 0065 | 0073 |     incomes = await db.transactions.find(
= 0066 | 0074 |         {"user_id": user["id"], "type": "receita", "date": {"$regex": f"^{month}"}}
= 0067 | 0075 |     ).to_list(500)
- 0068 | ---- |     income = round(sum(float(t["value"]) for t in incomes), 2)
- 0069 | ---- | 
+ ---- | 0076 |     income = round(sum((D(t["value"]) for t in incomes)), 2)
= 0070 | 0077 |     return SubscriptionsOut(
= 0071 | 0078 |         items=items,
= 0072 | 0079 |         monthly_total=monthly,
= 0073 | 0080 |         yearly_total=round(monthly * 12, 2),
- 0074 | ---- |         income_percent=round(monthly / income * 100, 1) if income else 0.0,
+ ---- | 0081 |         income_percent=round(monthly / income * 100, 1) if income else D("0.0"),
= 0075 | 0082 |     )
= 0076 | 0083 | 
```
