from finnos.lib.money import D, quantize_brl

"""Dashboard aggregate: total balance, month stats, category donut, 50/30/20 rule, recent."""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from finnos.lib.db import db
from finnos.lib.dates import today_iso
from finnos.lib.account_balances import AccountLedger
from finnos.lib.stats import add_months, month_bounds, month_portion
from finnos.lib.competency import monthly_competency, positive_category_slices
from finnos.models.finnos import CategorySlice, DashboardOut, RuleItem
from finnos.routers.auth import require_user
from finnos.routers.transactions import _ref_maps, enrich_transaction

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
GROUP_LABELS = {
    "necessidades": "Necessidades",
    "desejos": "Desejos",
    "metas": "Metas e investimentos",
}
GROUP_SHARES = {"necessidades": D("0.5"), "desejos": D("0.3"), "metas": D("0.2")}


@router.get("", response_model=DashboardOut)
async def dashboard(
    month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
    user: dict = Depends(require_user),
) -> DashboardOut:
    user_id = user["id"]
    today = today_iso()
    m = month or today[:7]
    prev_month = add_months(m, -1)
    accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
    categories = await db.categories.find({"user_id": user_id}).to_list(500)
    txs = await db.transactions.find({"user_id": user_id}).to_list(20000)
    cards = await db.cards.find({"user_id": user_id}).to_list(200)
    cat_by_id = {c["id"]: c for c in categories}
    # Same canonical cash ledger used by /accounts, rather than a second
    # implementation of balance math. Dashboard's competency scan is still
    # legacy and will be paginated separately before exceeding 20k rows.
    cash_ledger = AccountLedger(accounts, today)
    for tx in txs:
        cash_ledger.add(tx)
    total_balance = cash_ledger.total_balance
    month_actual = monthly_competency(txs, cards, m)
    last_actual = monthly_competency(txs, cards, prev_month)
    income, expense = month_actual["income"], month_actual["expense"]
    prev_income, prev_expense = last_actual["income"], last_actual["expense"]
    prev_count = sum(month_portion(tx, prev_month) is not None for tx in txs)
    by_category = month_actual["by_category"]
    by_group = {"necessidades": D("0.0"), "desejos": D("0.0"), "metas": D("0.0")}
    for cat_id, amount in by_category.items():
        cat = cat_by_id.get(cat_id)
        if cat:
            by_group[cat["group"]] += amount
    slices = []
    for cat_id, total, share in positive_category_slices(by_category):
        slice_cat = cat_by_id.get(cat_id)
        slices.append(
            CategorySlice(
                category_id=cat_id,
                name=slice_cat["name"] if slice_cat else "Sem categoria",
                color=slice_cat["color"] if slice_cat else "#94A3B8",
                icon=slice_cat["icon"] if slice_cat else "more-horizontal",
                total=quantize_brl(total),
                percent=share,
            )
        )
    rule = []
    for key in ("necessidades", "desejos", "metas"):
        spent = quantize_brl(by_group[key])
        limit = quantize_brl(income * GROUP_SHARES[key])
        percent = (
            round(spent / limit * 100, 1)
            if limit > 0
            else D("0.0") if spent == 0 else D("101.0")
        )
        status = "dentro" if percent <= 80 else "proximo" if percent <= 100 else "acima"
        rule.append(
            RuleItem(
                key=key,
                label=GROUP_LABELS[key],
                spent=spent,
                limit=limit,
                percent=percent,
                status=status,
            )
        )
    start, end = month_bounds(m)
    docs = (
        await db.transactions.find(
            {"user_id": user_id, "date": {"$gte": start, "$lte": end}}
        )
        .sort([("date", -1), ("created_at", -1)])
        .to_list(6, allow_truncate=True)
    )
    accounts_by_id, categories_by_id = await _ref_maps(user_id)
    return DashboardOut(
        month=m,
        total_balance=quantize_brl(total_balance),
        income=income,
        expense=expense,
        month_balance=quantize_brl(income - expense),
        prev_income=quantize_brl(prev_income) if prev_count else None,
        prev_expense=quantize_brl(prev_expense) if prev_count else None,
        invested=D("0.0"),
        categories=slices,
        rule=rule,
        recent=[enrich_transaction(d, accounts_by_id, categories_by_id) for d in docs],
    )
