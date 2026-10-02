"""Dashboard aggregate: total balance, month stats, category donut, 50/30/20 rule, recent."""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from lib.db import db
from lib.dates import today_iso
from lib.stats import add_months, balance_effects, month_bounds, month_portion
from models.finnos import CategorySlice, DashboardOut, RuleItem
from routers.auth import require_user
from routers.transactions import _ref_maps, enrich_transaction

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

GROUP_LABELS = {"necessidades": "Necessidades", "desejos": "Desejos", "metas": "Metas e investimentos"}
GROUP_SHARES = {"necessidades": 0.5, "desejos": 0.3, "metas": 0.2}


@router.get("", response_model=DashboardOut)
async def dashboard(
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    user: dict = Depends(require_user),
) -> DashboardOut:
    user_id = user["id"]
    today = today_iso()
    m = month or today[:7]
    prev_month = add_months(m, -1)

    accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
    categories = await db.categories.find({"user_id": user_id}).to_list(500)
    txs = await db.transactions.find({"user_id": user_id}).to_list(20000)
    cat_by_id = {c["id"]: c for c in categories}

    # Saldo total: initial balances + every peso already due up to today.
    total_balance = sum(float(a.get("initial_balance") or 0.0) for a in accounts)
    for tx in txs:
        for _acc, amount in balance_effects(tx, today):
            total_balance += amount

    income = expense = 0.0
    prev_income = prev_expense = 0.0
    prev_count = 0
    by_category: dict = {}
    by_group = {"necessidades": 0.0, "desejos": 0.0, "metas": 0.0}

    for tx in txs:
        portion = month_portion(tx, m)
        if portion is not None:
            if tx["type"] == "receita":
                income += portion
            else:
                expense += portion
                cat = cat_by_id.get(tx.get("category_id"))
                key = cat["id"] if cat else None
                by_category[key] = by_category.get(key, 0.0) + portion
                if cat:
                    by_group[cat["group"]] += portion
        prev_portion = month_portion(tx, prev_month)
        if prev_portion is not None:
            prev_count += 1
            if tx["type"] == "receita":
                prev_income += prev_portion
            else:
                prev_expense += prev_portion

    income = round(income, 2)
    expense = round(expense, 2)

    slices = []
    for cat_id, total in sorted(by_category.items(), key=lambda kv: -kv[1]):
        slice_cat = cat_by_id.get(cat_id)  # re-resolved per slice: reusing the loop's `cat` named every slice alike
        slices.append(
            CategorySlice(
                category_id=cat_id,
                name=slice_cat["name"] if slice_cat else "Sem categoria",
                color=slice_cat["color"] if slice_cat else "#94A3B8",
                icon=slice_cat["icon"] if slice_cat else "more-horizontal",
                total=round(total, 2),
                percent=round(total / expense * 100, 1) if expense else 0.0,
            )
        )

    rule = []
    for key in ("necessidades", "desejos", "metas"):
        spent = round(by_group[key], 2)
        limit = round(income * GROUP_SHARES[key], 2)
        percent = round(spent / limit * 100, 1) if limit > 0 else (0.0 if spent == 0 else 101.0)
        status = "dentro" if percent <= 80 else ("proximo" if percent <= 100 else "acima")
        rule.append(
            RuleItem(key=key, label=GROUP_LABELS[key], spent=spent, limit=limit, percent=percent, status=status)
        )

    start, end = month_bounds(m)
    docs = (
        await db.transactions.find({"user_id": user_id, "date": {"$gte": start, "$lte": end}})
        .sort([("date", -1), ("created_at", -1)])
        .to_list(6)
    )
    accounts_by_id, categories_by_id = await _ref_maps(user_id)

    return DashboardOut(
        month=m,
        total_balance=round(total_balance, 2),
        income=income,
        expense=expense,
        month_balance=round(income - expense, 2),
        # No fabricated comparisons: only when the previous month actually had data.
        prev_income=round(prev_income, 2) if prev_count else None,
        prev_expense=round(prev_expense, 2) if prev_count else None,
        invested=0.0,  # investments module arrives in a later delivery
        categories=slices,
        rule=rule,
        recent=[enrich_transaction(d, accounts_by_id, categories_by_id) for d in docs],
    )
