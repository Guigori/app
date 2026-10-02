"""Analytics: month-over-month trends and the monthly budget view."""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from lib.db import db
from lib.dates import today_iso
from lib.stats import add_months, month_portion
from models.analytics import BudgetRow, BudgetSummary, MonthTrend, TrendsOut
from routers.auth import require_user

router = APIRouter(prefix="/analytics", tags=["analytics"])

MONTH_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


def _label(month: str) -> str:
    return MONTH_ABBR[int(month[5:7]) - 1]


@router.get("/trends", response_model=TrendsOut)
async def trends(
    months: int = Query(default=6, ge=2, le=24),
    end_month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    user: dict = Depends(require_user),
) -> TrendsOut:
    """Income/expense/net per month, oldest first — powers the cash-flow table and bars."""
    last = end_month or today_iso()[:7]
    window = [add_months(last, -i) for i in range(months - 1, -1, -1)]
    txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)

    rows: list[MonthTrend] = []
    for m in window:
        income = expense = 0.0
        for tx in txs:
            portion = month_portion(tx, m)
            if portion is None:
                continue
            if tx["type"] == "receita":
                income += portion
            else:
                expense += portion
        rows.append(
            MonthTrend(
                month=m,
                label=_label(m),
                income=round(income, 2),
                expense=round(expense, 2),
                net=round(income - expense, 2),
            )
        )

    return TrendsOut(
        months=rows,
        total_income=round(sum(r.income for r in rows), 2),
        total_expense=round(sum(r.expense for r in rows), 2),
    )


@router.get("/budget", response_model=BudgetSummary)
async def budget(
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    user: dict = Depends(require_user),
) -> BudgetSummary:
    """Planned vs used per category for the month, with status that never relies on colour alone."""
    m = month or today_iso()[:7]
    categories = await db.categories.find({"user_id": user["id"]}).sort("created_at", 1).to_list(500)
    txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)

    spent_by_cat: dict[str | None, float] = {}
    income = 0.0
    for tx in txs:
        portion = month_portion(tx, m)
        if portion is None:
            continue
        if tx["type"] == "receita":
            income += portion
        else:
            key = tx.get("category_id")
            spent_by_cat[key] = spent_by_cat.get(key, 0.0) + portion

    rows: list[BudgetRow] = []
    for cat in categories:
        budget_value = round(float(cat.get("monthly_budget") or 0.0), 2)
        spent = round(spent_by_cat.get(cat["id"], 0.0), 2)
        if budget_value <= 0:
            status = "sem_limite"
            percent = 0.0
        else:
            percent = round(spent / budget_value * 100, 1)
            status = "dentro" if percent <= 80 else ("proximo" if percent <= 100 else "acima")
        # Rows with neither budget nor spending would be noise on the page.
        if budget_value <= 0 and spent <= 0:
            continue
        rows.append(
            BudgetRow(
                category_id=cat["id"],
                name=cat["name"],
                icon=cat.get("icon", "more-horizontal"),
                color=cat.get("color", "#64748B"),
                group=cat.get("group", "necessidades"),
                budget=budget_value,
                spent=spent,
                remaining=round(budget_value - spent, 2),
                percent=percent,
                status=status,
            )
        )

    rows.sort(key=lambda r: (r.budget <= 0, -r.percent, -r.spent))
    planned = round(sum(r.budget for r in rows), 2)
    spent_total = round(sum(r.spent for r in rows), 2)
    budgeted_spent = round(sum(r.spent for r in rows if r.budget > 0), 2)

    return BudgetSummary(
        month=m,
        planned=planned,
        spent=spent_total,
        remaining=round(planned - budgeted_spent, 2),
        percent=round(budgeted_spent / planned * 100, 1) if planned else 0.0,
        income=round(income, 2),
        unbudgeted_spent=round(spent_total - budgeted_spent, 2),
        rows=rows,
    )
