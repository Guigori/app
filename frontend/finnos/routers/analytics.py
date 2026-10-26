from finnos.lib.money import D

"""Analytics: month-over-month trends and the monthly budget view."""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from finnos.lib.db import db
from finnos.lib.dates import today_iso
from finnos.lib.stats import add_months, month_bounds, month_portion, months_between
from finnos.lib.recurrence import monthly_projection_sources
from finnos.lib.category_pace import monthly_pace
from finnos.lib.competency import monthly_competency
from finnos.models.analytics import (
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
from finnos.routers.auth import require_user

router = APIRouter(prefix="/analytics", tags=["analytics"])
MONTH_ABBR = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
]


def _label(month: str) -> str:
    return MONTH_ABBR[int(month[5:7]) - 1]


@router.get("/trends", response_model=TrendsOut)
async def trends(
    months: int = Query(default=6, ge=2, le=24),
    end_month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
    user: dict = Depends(require_user),
) -> TrendsOut:
    """Income/expense/net per month, oldest first — powers the cash-flow table and bars."""
    last = end_month or today_iso()[:7]
    window = [add_months(last, -i) for i in range(months - 1, -1, -1)]
    txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)
    cards = await db.cards.find({"user_id": user["id"]}).to_list(200)
    rows: list[MonthTrend] = []
    for m in window:
        monthly = monthly_competency(txs, cards, m)
        income, expense = monthly["income"], monthly["expense"]
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
        total_income=round(sum((r.income for r in rows)), 2),
        total_expense=round(sum((r.expense for r in rows)), 2),
    )


@router.get("/budget", response_model=BudgetSummary)
async def budget(
    month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
    user: dict = Depends(require_user),
) -> BudgetSummary:
    """Planned vs used per category for the month, with status that never relies on colour alone."""
    m = month or today_iso()[:7]
    categories = (
        await db.categories.find({"user_id": user["id"]})
        .sort("created_at", 1)
        .to_list(500)
    )
    txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)
    cards = await db.cards.find({"user_id": user["id"]}).to_list(200)
    monthly = monthly_competency(txs, cards, m)
    spent_by_cat, income = monthly["by_category"], monthly["income"]
    rows: list[BudgetRow] = []
    for cat in categories:
        budget_value = round(D(cat.get("monthly_budget") or D("0.0")), 2)
        spent = round(spent_by_cat.get(cat["id"], D("0.0")), 2)
        pace = monthly_pace(budget_value, txs, cat["id"], m, as_of=today_iso())
        if budget_value <= 0:
            status = "sem_limite"
            percent = D("0.0")
        else:
            percent = round(spent / budget_value * 100, 1)
            status = (
                "dentro" if percent <= 80 else "proximo" if percent <= 100 else "acima"
            )
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
                pace_day=pace["day"],
                pace_days_in_month=pace["days_in_month"],
                pace_ideal=D(pace["ideal_cents"]) / 100,
                pace_daily_allowance=D(pace["daily_allowance_cents"]) / 100,
                pace_projected_close=D(pace["projected_month_end_cents"]) / 100,
                pace_difference=D(pace["diff_from_ideal_cents"]) / 100,
                pace_cumulative=[D(value) / 100 for value in pace["cumulative_cents"]],
            )
        )
    rows.sort(key=lambda r: (r.budget <= 0, -r.percent, -r.spent))
    planned = round(sum((r.budget for r in rows)), 2)
    spent_total = round(sum((r.spent for r in rows)), 2)
    budgeted_spent = round(sum((r.spent for r in rows if r.budget > 0)), 2)
    return BudgetSummary(
        month=m,
        planned=planned,
        spent=spent_total,
        remaining=round(planned - budgeted_spent, 2),
        percent=round(budgeted_spent / planned * 100, 1) if planned else D("0.0"),
        income=round(income, 2),
        unbudgeted_spent=round(spent_total - budgeted_spent, 2),
        rows=rows,
    )


def _amount(tx: dict) -> float:
    """What a single occurrence of the transaction is worth."""
    if tx.get("installment"):
        return round(D(tx.get("installment_value") or D("0.0")), 2)
    return round(D(tx["value"]), 2)


def _projection(tx: dict, month: str) -> float | None:
    """An explicitly scheduled/pending entry projects only on its own month.

    Monthly recurrence projections are emitted separately by the shared helper.
    """
    if tx.get("invoice_payment") or tx.get("type") == "transferencia":
        return None
    if tx.get("status") != "pago" and tx["date"][:7] == month:
        return _amount(tx)
    return None


@router.get("/flow", response_model=FlowOut)
async def flow(
    month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
    months: int = Query(default=12, ge=2, le=24),
    from_month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
    to_month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
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
        start, end = (
            (from_month, to_month) if from_month <= to_month else (to_month, from_month)
        )
        span = min(months_between(start, end), 35)
        window = [add_months(start, i) for i in range(span + 1)]
    else:
        window = [add_months(focus, -i) for i in range(months - 1, -1, -1)]
        window += [add_months(focus, 1), add_months(focus, 2)]
    txs = await db.transactions.find({"user_id": user["id"]}).to_list(20000)
    cards = await db.cards.find({"user_id": user["id"]}).to_list(200)
    if category_id:
        txs = [tx for tx in txs if tx.get("category_id") == category_id]
    categories = await db.categories.find({"user_id": user["id"]}).to_list(500)
    cat_by_id = {c["id"]: c for c in categories}
    today_month = today_iso()[:7]
    series: list[FlowPoint] = []
    for m in window:
        monthly = monthly_competency(txs, cards, m)
        income, expense = monthly["income"], monthly["expense"]
        p_income = p_expense = D("0.0")
        for tx in txs:
            projected = _projection(tx, m)
            if projected is not None:
                if tx["type"] == "receita":
                    p_income += projected
                else:
                    p_expense += projected
        # Emit one future recurring expense/income per logical series, not one
        # for every fixed transaction ever entered.
        for source, _ in monthly_projection_sources(txs, m):
            if source["type"] == "receita":
                p_income += _amount(source)
            else:
                p_expense += _amount(source)
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
    by_cat = monthly_competency(txs, cards, focus)["by_category"]
    focus_expense = round(sum(by_cat.values()), 2)
    breakdown = [
        FlowCategory(
            category_id=key,
            name=(
                cat_by_id.get(key, {}).get("name", "Sem categoria")
                if key
                else "Sem categoria"
            ),
            color=cat_by_id.get(key, {}).get("color", "#94A3B8") if key else "#94A3B8",
            icon=(
                cat_by_id.get(key, {}).get("icon", "more-horizontal")
                if key
                else "more-horizontal"
            ),
            total=round(value, 2),
            percent=(
                round(value / focus_expense * 100, 1) if focus_expense else D("0.0")
            ),
        )
        for key, value in sorted(by_cat.items(), key=lambda kv: -kv[1])
    ]
    point = next((p for p in series if p.month == focus), None)
    return FlowOut(
        month=focus,
        from_month=window[0],
        to_month=window[-1],
        income=point.income if point else D("0.0"),
        expense=point.expense if point else D("0.0"),
        net=point.net if point else D("0.0"),
        projected_income=point.projected_income if point else D("0.0"),
        projected_expense=point.projected_expense if point else D("0.0"),
        projected_net=point.projected_net if point else D("0.0"),
        total_income=round(sum((p.income for p in series)), 2),
        total_expense=round(sum((p.expense for p in series)), 2),
        total_net=round(sum((p.net for p in series)), 2),
        series=series,
        categories=breakdown,
    )


@router.get("/calendar", response_model=CalendarOut)
async def calendar_month(
    month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
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
            DayFlow(
                date=tx["date"],
                income=D("0.0"),
                expense=D("0.0"),
                projected_income=D("0.0"),
                projected_expense=D("0.0"),
                count=0,
            ),
        )
        day.count += 1
        # Invoice payment is a bank movement, not a second purchase expense.
        if tx["type"] == "transferencia" or tx.get("invoice_payment"):
            continue
        value = _amount(tx)
        if tx.get("status") == "pago":
            if tx["type"] == "receita":
                day.income = round(D(day.income) + value, 2)
            else:
                day.expense = round(D(day.expense) + value, 2)
        elif tx["type"] == "receita":
            day.projected_income = round(D(day.projected_income) + value, 2)
        else:
            day.projected_expense = round(D(day.projected_expense) + value, 2)
    days = sorted(buckets.values(), key=lambda d: d.date)
    income = round(sum((d.income for d in days)), 2)
    expense = round(sum((d.expense for d in days)), 2)
    p_income = round(sum((d.projected_income for d in days)), 2)
    p_expense = round(sum((d.projected_expense for d in days)), 2)
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
