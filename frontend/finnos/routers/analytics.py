from finnos.lib.money import D, quantize_brl

"""Analytics: month-over-month trends and the monthly budget view."""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from finnos.lib.db import db
from finnos.lib.dates import today_iso
from finnos.lib.stats import add_months, month_bounds, month_portion, months_between
from finnos.lib.recurrence import monthly_projection_sources
from finnos.lib.subscription_projection import planned_subscriptions
from finnos.lib.category_pace import monthly_pace
from finnos.lib.competency import monthly_competency, credit_events, positive_category_slices
from finnos.lib.transaction_amount import occurrence_amount as _amount
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
                income=quantize_brl(income),
                expense=quantize_brl(expense),
                net=quantize_brl(income - expense),
            )
        )
    return TrendsOut(
        months=rows,
        total_income=quantize_brl(sum((r.income for r in rows))),
        total_expense=quantize_brl(sum((r.expense for r in rows))),
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
    adjustments = credit_events(cards, txs)
    rows: list[BudgetRow] = []
    for cat in categories:
        budget_value = quantize_brl(D(cat.get("monthly_budget") or D("0.0")))
        spent = quantize_brl(spent_by_cat.get(cat["id"], D("0.0")))
        pace = monthly_pace(budget_value, txs, cat["id"], m, as_of=today_iso(), credits=adjustments)
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
                remaining=quantize_brl(budget_value - spent),
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
    planned = quantize_brl(sum((r.budget for r in rows)))
    spent_total = quantize_brl(sum((r.spent for r in rows)))
    budgeted_spent = quantize_brl(sum((r.spent for r in rows if r.budget > 0)))
    return BudgetSummary(
        month=m,
        planned=planned,
        spent=spent_total,
        remaining=quantize_brl(planned - budgeted_spent),
        percent=round(budgeted_spent / planned * 100, 1) if planned else D("0.0"),
        income=quantize_brl(income),
        unbudgeted_spent=quantize_brl(spent_total - budgeted_spent),
        rows=rows,
    )


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
    subscriptions = await db.subscriptions.find({"user_id": user["id"]}).to_list(500)
    source_txs = txs  # preserve all bills for subscription duplicate detection
    if category_id:
        txs = [tx for tx in txs if tx.get("category_id") == category_id]
        subscriptions = [sub for sub in subscriptions if sub.get("category_id") == category_id]
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
        # Subscription is a plan, not a paid transaction. Add only future
        # billing dates absent from explicit and recurring transactions.
        for sub, _ in planned_subscriptions(subscriptions, source_txs, m, today_iso()):
            p_expense += D(sub["value"])
        series.append(
            FlowPoint(
                month=m,
                label=_label(m),
                year=f"'{m[2:4]}",
                income=quantize_brl(income),
                expense=quantize_brl(expense),
                net=quantize_brl(income - expense),
                projected_income=quantize_brl(p_income),
                projected_expense=quantize_brl(p_expense),
                projected_net=quantize_brl(p_income - p_expense),
                future=m > today_month,
            )
        )
    by_cat = monthly_competency(txs, cards, focus)["by_category"]
    # FIN-08: refunds may make a category negative. The signed values remain
    # in net expense/budget, but "Onde foi o dinheiro" is a positive-spend
    # breakdown and must not show negative bars or percentages above 100%.
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
            total=quantize_brl(value),
            percent=percent,
        )
        for key, value, percent in positive_category_slices(by_cat)
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
        total_income=quantize_brl(sum((p.income for p in series))),
        total_expense=quantize_brl(sum((p.expense for p in series))),
        total_net=quantize_brl(sum((p.net for p in series))),
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
        if (tx["type"] == "transferencia" or tx.get("invoice_payment")
                or tx.get("invoice_refund")):
            continue
        value = _amount(tx)
        if tx.get("status") == "pago":
            if tx["type"] == "receita":
                day.income = quantize_brl(D(day.income) + value)
            else:
                day.expense = quantize_brl(D(day.expense) + value)
        elif tx["type"] == "receita":
            day.projected_income = quantize_brl(D(day.projected_income) + value)
        else:
            day.projected_expense = quantize_brl(D(day.projected_expense) + value)
    # FIN-08/14: reverse a purchase as a negative expense on the actual
    # compensation date. An invoice bank refund must not be counted as new
    # salary or income, even when the original purchase was in a prior month.
    cards = await db.cards.find({"user_id": user["id"]}).to_list(200)
    if any(
        entry.get("date", "")[:7] == m
        for card in cards
        for ledger in ("invoice_adjustments", "invoice_refunds")
        for events in (card.get(ledger) or {}).values()
        for entry in events
    ):
        originals = await db.transactions.find(
            {"user_id": user["id"]}
        ).to_list(20000)
        for credit in credit_events(cards, originals):
            day_key = credit["date"]
            if day_key[:7] != m:
                continue
            is_new_day = day_key not in buckets
            day = buckets.setdefault(
                day_key, DayFlow(date=day_key, income=D("0.0"),
                                 expense=D("0.0"), projected_income=D("0.0"),
                                 projected_expense=D("0.0"), count=0),
            )
            day.expense = quantize_brl(D(day.expense) - D(credit["cents"]) / 100)
            if credit["kind"] == "merchant_credit":
                day.count += 1
            # A bank-refund transaction has already contributed its own day
            # count; do not duplicate it on the calendar.
    # A subscription is a forecast only. It does not turn into a bank debit,
    # and an existing or recurring transaction suppresses its projection.
    subscriptions = await db.subscriptions.find(
        {"user_id": user["id"]}
    ).to_list(500)
    if subscriptions:
        # Historical fixed expenses may already forecast the same plan; the
        # current-month subset alone cannot detect such a prior recurring row.
        all_txs = await db.transactions.find(
            {"user_id": user["id"]}
        ).to_list(20000)
        for sub, charge in planned_subscriptions(
            subscriptions, all_txs, m, today_iso()
        ):
            key = charge.isoformat()
            day = buckets.setdefault(
                key, DayFlow(date=key, income=D("0.0"),
                             expense=D("0.0"), projected_income=D("0.0"),
                             projected_expense=D("0.0"), count=0),
            )
            day.projected_expense = quantize_brl(
                D(day.projected_expense) + D(sub["value"])
            )
            # This is not an actual transaction. Preserve count = recorded
            # rows so clicking the day does not imply a nonexistent entry.
    days = sorted(buckets.values(), key=lambda d: d.date)
    income = quantize_brl(sum((d.income for d in days)))
    expense = quantize_brl(sum((d.expense for d in days)))
    p_income = quantize_brl(sum((d.projected_income for d in days)))
    p_expense = quantize_brl(sum((d.projected_expense for d in days)))
    return CalendarOut(
        month=m,
        days=days,
        income=income,
        expense=expense,
        net=quantize_brl(income - expense),
        projected_income=p_income,
        projected_expense=p_expense,
        projected_balance=quantize_brl(income - expense + p_income - p_expense),
    )
