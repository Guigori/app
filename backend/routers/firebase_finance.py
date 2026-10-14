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
