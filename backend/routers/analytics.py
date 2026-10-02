"""Analytics: month-over-month trends and the monthly budget view."""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from lib.db import db
from lib.dates import today_iso
from lib.stats import add_months, month_bounds, month_portion, months_between
from models.analytics import (
    BudgetRow,
    BudgetSummary,
    CalendarOut,
    DayFlow,
    FlowCategory,
    FlowOut,
    FlowPoint,
    MonthTrend,
    TrendsOut,
)
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


# --- Fluxo -------------------------------------------------------------------


def _amount(tx: dict) -> float:
    """What a single occurrence of the transaction is worth."""
    if tx.get("installment"):
        return round(float(tx.get("installment_value") or 0.0), 2)
    return round(float(tx["value"]), 2)


def _projection(tx: dict, month: str, settled_keys: set) -> float | None:
    """Money still expected in `month`: pending/scheduled entries on their own month,
    plus "fixa mensal" entries repeating into later months (skipped when a real
    transaction with the same name already exists in that month, so nothing doubles)."""
    if tx.get("type") == "transferencia":
        return None
    tx_month = tx["date"][:7]
    if tx.get("status") != "pago" and tx_month == month:
        return _amount(tx)
    if tx.get("fixed") and (tx.get("recurrence") or "mensal") == "mensal":
        if months_between(tx_month, month) > 0 and (tx["name"].strip().lower(), month) not in settled_keys:
            return _amount(tx)
    return None


@router.get("/flow", response_model=FlowOut)
async def flow(
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    months: int = Query(default=12, ge=2, le=24),
    from_month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    to_month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    category_id: Optional[str] = Query(default=None),
    user: dict = Depends(require_user),
) -> FlowOut:
    """Cash flow for a period: realised income/expense per month, the projection for the
    months ahead and where the money went in the focus month.

    Window: `from_month`/`to_month` when both are given (período personalizado), else the
    last `months` months ending on the focus month plus two months of projection.
    """
    focus = month or today_iso()[:7]
    if from_month and to_month:
        start, end = (from_month, to_month) if from_month <= to_month else (to_month, from_month)
        span = min(months_between(start, end), 35)
        window = [add_months(start, i) for i in range(span + 1)]
    else:
        window = [add_months(focus, -i) for i in range(months - 1, -1, -1)]
        window += [add_months(focus, 1), add_months(focus, 2)]

    txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)
    if category_id:
        txs = [tx for tx in txs if tx.get("category_id") == category_id]
    categories = await db.categories.find({"user_id": user["id"]}).to_list(500)
    cat_by_id = {c["id"]: c for c in categories}

    settled_keys = {(tx["name"].strip().lower(), tx["date"][:7]) for tx in txs}
    today_month = today_iso()[:7]

    series: list[FlowPoint] = []
    for m in window:
        income = expense = p_income = p_expense = 0.0
        for tx in txs:
            portion = month_portion(tx, m)
            if portion is not None:
                if tx["type"] == "receita":
                    income += portion
                else:
                    expense += portion
            projected = _projection(tx, m, settled_keys)
            if projected is not None:
                if tx["type"] == "receita":
                    p_income += projected
                else:
                    p_expense += projected
        series.append(
            FlowPoint(
                month=m,
                label=_label(m),
                year=f"'{m[2:4]}",
                income=round(income, 2),
                expense=round(expense, 2),
                net=round(income - expense, 2),
                projected_income=round(p_income, 2),
                projected_expense=round(p_expense, 2),
                projected_net=round(p_income - p_expense, 2),
                future=m > today_month,
            )
        )

    # "Onde foi o dinheiro" — expenses of the focus month by category.
    by_cat: dict[str | None, float] = {}
    for tx in txs:
        portion = month_portion(tx, focus)
        if portion is None or tx["type"] == "receita":
            continue
        key = tx.get("category_id")
        by_cat[key] = by_cat.get(key, 0.0) + portion
    focus_expense = round(sum(by_cat.values()), 2)
    breakdown = [
        FlowCategory(
            category_id=key,
            name=cat_by_id.get(key, {}).get("name", "Sem categoria") if key else "Sem categoria",
            color=cat_by_id.get(key, {}).get("color", "#94A3B8") if key else "#94A3B8",
            icon=cat_by_id.get(key, {}).get("icon", "more-horizontal") if key else "more-horizontal",
            total=round(value, 2),
            percent=round(value / focus_expense * 100, 1) if focus_expense else 0.0,
        )
        for key, value in sorted(by_cat.items(), key=lambda kv: -kv[1])
    ]

    point = next((p for p in series if p.month == focus), None)
    return FlowOut(
        month=focus,
        from_month=window[0],
        to_month=window[-1],
        income=point.income if point else 0.0,
        expense=point.expense if point else 0.0,
        net=point.net if point else 0.0,
        projected_income=point.projected_income if point else 0.0,
        projected_expense=point.projected_expense if point else 0.0,
        projected_net=point.projected_net if point else 0.0,
        total_income=round(sum(p.income for p in series), 2),
        total_expense=round(sum(p.expense for p in series), 2),
        total_net=round(sum(p.net for p in series), 2),
        series=series,
        categories=breakdown,
    )


# --- Calendário --------------------------------------------------------------


@router.get("/calendar", response_model=CalendarOut)
async def calendar_month(
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    user: dict = Depends(require_user),
) -> CalendarOut:
    """Per-day entradas/saídas of the month, plus what is still only expected."""
    m = month or today_iso()[:7]
    start, end = month_bounds(m)
    txs = await db.transactions.find(
        {"user_id": user["id"], "date": {"$gte": start, "$lte": end}}
    ).to_list(5000)

    buckets: dict[str, DayFlow] = {}
    for tx in txs:
        day = buckets.setdefault(
            tx["date"],
            DayFlow(date=tx["date"], income=0.0, expense=0.0, projected_income=0.0, projected_expense=0.0, count=0),
        )
        day.count += 1
        if tx["type"] == "transferencia":
            continue
        value = _amount(tx)
        if tx.get("status") == "pago":
            if tx["type"] == "receita":
                day.income = round(day.income + value, 2)
            else:
                day.expense = round(day.expense + value, 2)
        else:
            if tx["type"] == "receita":
                day.projected_income = round(day.projected_income + value, 2)
            else:
                day.projected_expense = round(day.projected_expense + value, 2)

    days = sorted(buckets.values(), key=lambda d: d.date)
    income = round(sum(d.income for d in days), 2)
    expense = round(sum(d.expense for d in days), 2)
    p_income = round(sum(d.projected_income for d in days), 2)
    p_expense = round(sum(d.projected_expense for d in days), 2)

    return CalendarOut(
        month=m,
        days=days,
        income=income,
        expense=expense,
        net=round(income - expense, 2),
        projected_income=p_income,
        projected_expense=p_expense,
        projected_balance=round(income - expense + p_income - p_expense, 2),
    )
