"""Read-only financial compatibility endpoints; always scoped by verified Firebase UID."""
from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from lib.firebase_auth import require_verified_firebase_user
from lib.firestore_finance_view import read_view, account_summaries, enriched_transaction, dashboard
from lib.dates import today_iso
from lib.stats import add_months, month_portion
from models.finnos import AccountOut, AccountDetailOut, DashboardOut, TransactionOut
from models.analytics import TrendsOut, MonthTrend, BudgetSummary, BudgetRow
from routers.cards import _build as card_summary

router = APIRouter(prefix="/firebase/finance", tags=["firebase-finance"])


async def view_for(user):
    return await run_in_threadpool(lambda: read_view(user["uid"]))


@router.get("/dashboard", response_model=DashboardOut)
async def get_dashboard(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    user: dict = Depends(require_verified_firebase_user),
):
    return dashboard(await view_for(user), month)


@router.get("/accounts", response_model=list[AccountOut])
async def get_accounts(user: dict = Depends(require_verified_firebase_user)):
    return account_summaries(await view_for(user))


@router.get("/accounts/{account_id}", response_model=AccountDetailOut)
async def get_account(account_id: str, user: dict = Depends(require_verified_firebase_user)):
    view = await view_for(user)
    account = next((a for a in account_summaries(view) if a.id == account_id), None)
    if account is None:
        raise HTTPException(404, "Conta não encontrada.")
    related = [tx for tx in view["transactions"]
               if tx.get("account_id") == account_id or tx.get("to_account_id") == account_id]
    related.sort(key=lambda tx: (tx["date"], str(tx.get("created_at", ""))), reverse=True)
    return AccountDetailOut(account=account,
                            transactions=[enriched_transaction(tx, view) for tx in related[:8]])


@router.get("/transactions", response_model=list[TransactionOut])
async def get_transactions(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    start_date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    type: str | None = None,
    status: str | None = None,
    category_id: str | None = None,
    account_id: str | None = None,
    search: str | None = Query(default=None, max_length=80),
    user: dict = Depends(require_verified_firebase_user),
):
    if type and type not in ("receita", "despesa", "transferencia"):
        raise HTTPException(422, "Tipo inválido.")
    if status and status not in ("pago", "pendente", "agendado"):
        raise HTTPException(422, "Status inválido.")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, "Intervalo inválido.")
    view = await view_for(user)
    rows = []
    for tx in view["transactions"]:
        date = tx["date"]
        if start_date or end_date:
            if start_date and date < start_date or end_date and date > end_date:
                continue
        elif month and not date.startswith(month):
            continue
        if type and tx["type"] != type or status and tx["status"] != status:
            continue
        if category_id and tx.get("category_id") != category_id:
            continue
        if account_id and account_id not in (tx.get("account_id"), tx.get("to_account_id")):
            continue
        if search and search.casefold() not in tx.get("name", "").casefold():
            continue
        rows.append(tx)
    rows.sort(key=lambda tx: (tx["date"], str(tx.get("created_at", ""))), reverse=True)
    return [enriched_transaction(tx, view) for tx in rows]


@router.get("/cards")
async def get_cards(user: dict = Depends(require_verified_firebase_user)):
    view = await view_for(user)
    accounts = {a["id"]: a for a in view["accounts"]}
    docs = sorted(view["cards"], key=lambda item: str(item.get("created_at", "")))
    return [await card_summary(card, view["transactions"], accounts) for card in docs]


@router.get("/analytics/trends", response_model=TrendsOut)
async def get_trends(
    months: int = Query(default=6, ge=2, le=24),
    end_month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    user: dict = Depends(require_verified_firebase_user),
):
    view = await view_for(user)
    last = end_month or today_iso()[:7]
    labels = ("jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez")
    rows = []
    for step in range(months - 1, -1, -1):
        month = add_months(last, -step)
        income = expense = 0.0
        for tx in view["transactions"]:
            portion = month_portion(tx, month)
            if portion is not None:
                if tx["type"] == "receita":
                    income += portion
                else:
                    expense += portion
        rows.append(MonthTrend(month=month, label=labels[int(month[5:7]) - 1],
                               income=round(income, 2), expense=round(expense, 2),
                               net=round(income - expense, 2)))
    return TrendsOut(months=rows, total_income=round(sum(r.income for r in rows), 2),
                     total_expense=round(sum(r.expense for r in rows), 2))


@router.get("/analytics/budget", response_model=BudgetSummary)
async def get_budget(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    user: dict = Depends(require_verified_firebase_user),
):
    view = await view_for(user)
    m = month or today_iso()[:7]
    spent = {}
    income = 0.0
    for tx in view["transactions"]:
        amount = month_portion(tx, m)
        if amount is None:
            continue
        if tx["type"] == "receita":
            income += amount
        else:
            category_id = tx.get("category_id")
            spent[category_id] = spent.get(category_id, 0.0) + amount
    rows = []
    for cat in view["categories"]:
        budget = round(float(cat.get("monthly_budget") or 0), 2)
        used = round(spent.get(cat["id"], 0), 2)
        if budget <= 0 and used <= 0:
            continue
        percent = round(used / budget * 100, 1) if budget else 0
        state = "sem_limite" if not budget else "dentro" if percent <= 80 else "proximo" if percent <= 100 else "acima"
        rows.append(BudgetRow(category_id=cat["id"], name=cat["name"],
                              icon=cat.get("icon", "more-horizontal"),
                              color=cat.get("color", "#64748B"),
                              group=cat.get("group", "necessidades"),
                              budget=budget, spent=used, remaining=round(budget - used, 2),
                              percent=percent, status=state))
    rows.sort(key=lambda r: (r.budget <= 0, -r.percent, -r.spent))
    planned = round(sum(r.budget for r in rows), 2)
    total = round(sum(r.spent for r in rows), 2)
    budgeted = round(sum(r.spent for r in rows if r.budget > 0), 2)
    return BudgetSummary(month=m, planned=planned, spent=total,
                         remaining=round(planned - budgeted, 2),
                         percent=round(budgeted / planned * 100, 1) if planned else 0,
                         income=round(income, 2),
                         unbudgeted_spent=round(total - budgeted, 2), rows=rows)

# Flow and calendar use the same pure monthly allocation algorithms as MongoDB.
from lib.stats import months_between
from models.analytics import FlowOut, FlowPoint, FlowCategory, CalendarOut, DayFlow
from routers.analytics import _projection, _amount, _label


@router.get("/analytics/flow", response_model=FlowOut)
async def get_flow(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    months: int = Query(default=12, ge=2, le=24),
    from_month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    to_month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    category_id: str | None = None,
    user: dict = Depends(require_verified_firebase_user),
):
    view = await view_for(user)
    focus = month or today_iso()[:7]
    if from_month and to_month:
        start, end = sorted((from_month, to_month))
        window = [add_months(start, i) for i in range(min(months_between(start, end), 35) + 1)]
    else:
        window = [add_months(focus, -i) for i in range(months - 1, -1, -1)]
        window.extend((add_months(focus, 1), add_months(focus, 2)))
    txs = [tx for tx in view["transactions"] if not category_id or tx.get("category_id") == category_id]
    cats = {cat["id"]: cat for cat in view["categories"]}
    settled_keys = {(tx["name"].strip().lower(), tx["date"][:7]) for tx in txs}
    current = today_iso()[:7]
    series = []
    for m in window:
        income = expense = future_income = future_expense = 0.0
        for tx in txs:
            paid = month_portion(tx, m)
            if paid is not None:
                if tx["type"] == "receita":
                    income += paid
                else:
                    expense += paid
            projected = _projection(tx, m, settled_keys)
            if projected is not None:
                if tx["type"] == "receita":
                    future_income += projected
                else:
                    future_expense += projected
        series.append(FlowPoint(
            month=m, label=_label(m), year=f"'{m[2:4]}",
            income=round(income, 2), expense=round(expense, 2), net=round(income - expense, 2),
            projected_income=round(future_income, 2), projected_expense=round(future_expense, 2),
            projected_net=round(future_income - future_expense, 2), future=m > current))
    cat_total = {}
    for tx in txs:
        portion = month_portion(tx, focus)
        if portion is not None and tx["type"] == "despesa":
            cat_id = tx.get("category_id")
            cat_total[cat_id] = cat_total.get(cat_id, 0) + portion
    total = sum(cat_total.values())
    breakdown = [FlowCategory(
        category_id=key,
        name=cats.get(key, {}).get("name", "Sem categoria") if key else "Sem categoria",
        color=cats.get(key, {}).get("color", "#94A3B8") if key else "#94A3B8",
        icon=cats.get(key, {}).get("icon", "more-horizontal") if key else "more-horizontal",
        total=round(value, 2), percent=round(value / total * 100, 1) if total else 0,
    ) for key, value in sorted(cat_total.items(), key=lambda item: -item[1])]
    point = next((p for p in series if p.month == focus), None)
    return FlowOut(
        month=focus, from_month=window[0], to_month=window[-1],
        income=point.income if point else 0, expense=point.expense if point else 0,
        net=point.net if point else 0, projected_income=point.projected_income if point else 0,
        projected_expense=point.projected_expense if point else 0,
        projected_net=point.projected_net if point else 0,
        total_income=round(sum(p.income for p in series), 2),
        total_expense=round(sum(p.expense for p in series), 2),
        total_net=round(sum(p.net for p in series), 2),
        series=series, categories=breakdown)


@router.get("/analytics/calendar", response_model=CalendarOut)
async def get_calendar(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    user: dict = Depends(require_verified_firebase_user),
):
    view = await view_for(user)
    m = month or today_iso()[:7]
    buckets = {}
    for tx in view["transactions"]:
        if not tx["date"].startswith(m):
            continue
        day = buckets.setdefault(tx["date"], DayFlow(
            date=tx["date"], income=0, expense=0,
            projected_income=0, projected_expense=0, count=0))
        day.count += 1
        if tx["type"] == "transferencia":
            continue
        amount = _amount(tx)
        if tx["status"] == "pago":
            if tx["type"] == "receita":
                day.income = round(day.income + amount, 2)
            else:
                day.expense = round(day.expense + amount, 2)
        elif tx["type"] == "receita":
            day.projected_income = round(day.projected_income + amount, 2)
        else:
            day.projected_expense = round(day.projected_expense + amount, 2)
    days = sorted(buckets.values(), key=lambda day: day.date)
    income = round(sum(day.income for day in days), 2)
    expense = round(sum(day.expense for day in days), 2)
    projected_income = round(sum(day.projected_income for day in days), 2)
    projected_expense = round(sum(day.projected_expense for day in days), 2)
    return CalendarOut(month=m, days=days, income=income, expense=expense,
        net=round(income - expense, 2),
        projected_income=projected_income, projected_expense=projected_expense,
        projected_balance=round(income - expense + projected_income - projected_expense, 2))
