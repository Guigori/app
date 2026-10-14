"""Firestore-only financial read model. Do not mix these reads with MongoDB."""
from datetime import datetime, timezone
from fastapi import HTTPException

from lib.firebase import get_firestore
from lib.dates import today_iso
from lib.stats import balance_effects, month_portion, add_months
from models.finnos import AccountOut, TransactionOut, DashboardOut, CategorySlice, RuleItem
from routers.firebase_transactions import _public

CAPS = {"accounts": 500, "categories": 500, "cards": 200, "transactions": 20000}
SHARES = {"necessidades": .5, "desejos": .3, "metas": .2}
LABELS = {"necessidades": "Necessidades", "desejos": "Desejos", "metas": "Metas e investimentos"}

def read_view(uid):
    root = get_firestore().collection("users").document(uid)
    result = {}
    for kind, cap in CAPS.items():
        snapshots = list(root.collection(kind).limit(cap + 1).stream())
        if len(snapshots) > cap:
            raise HTTPException(409, f"Paginação pendente para {kind}; leitura financeira interrompida.")
        docs = [snapshot.to_dict() for snapshot in snapshots]
        result[kind] = [_public(doc) for doc in docs] if kind == "transactions" else docs
    return result

def enriched_transaction(tx, view):
    accounts = {x["id"]: x for x in view["accounts"]}
    categories = {x["id"]: x for x in view["categories"]}
    cards = {x["id"]: x for x in view["cards"]}
    account = accounts.get(tx.get("account_id"), {})
    target = accounts.get(tx.get("to_account_id"), {})
    category = categories.get(tx.get("category_id"), {})
    card = cards.get(tx.get("card_id"), {})
    return TransactionOut(
        **{key: value for key, value in tx.items() if key in TransactionOut.model_fields
           and key not in {"account_name", "to_account_name", "category_name", "category_color", "category_icon", "card_name"}},
        account_name=account.get("name", ""),
        to_account_name=target.get("name"),
        category_name=category.get("name"),
        category_color=category.get("color"),
        category_icon=category.get("icon"),
        card_name=card.get("name"),
        created_at=tx.get("created_at") or datetime.now(timezone.utc),
    )

def account_summaries(view):
    today = today_iso()
    balance = {x["id"]: float(x.get("initial_balance") or 0) for x in view["accounts"]}
    income = {x["id"]: 0.0 for x in view["accounts"]}
    expense = {x["id"]: 0.0 for x in view["accounts"]}
    for tx in view["transactions"]:
        for account_id, amount in balance_effects(tx, today):
            if account_id not in balance:
                raise HTTPException(409, "Lançamento aponta para conta inexistente.")
            balance[account_id] += amount
            if tx["type"] == "receita":
                income[account_id] += amount
            elif tx["type"] == "despesa":
                expense[account_id] -= amount
    return [AccountOut(
        **{key: value for key, value in account.items() if key in AccountOut.model_fields
           and key not in {"balance", "total_income", "total_expense"}},
        balance=round(balance[account["id"]], 2),
        total_income=round(max(income[account["id"]], 0), 2),
        total_expense=round(max(expense[account["id"]], 0), 2),
    ) for account in sorted(view["accounts"], key=lambda row: str(row.get("created_at", "")))]

def dashboard(view, month=None):
    m = month or today_iso()[:7]
    previous = add_months(m, -1)
    cats = {c["id"]: c for c in view["categories"]}
    total_balance = sum(a.balance for a in account_summaries(view))
    income = expense = prev_income = prev_expense = 0.0
    prev_count = 0
    per_cat = {}
    per_group = {group: 0.0 for group in SHARES}
    for tx in view["transactions"]:
        value = month_portion(tx, m)
        if value is not None:
            if tx["type"] == "receita":
                income += value
            else:
                expense += value
                category = cats.get(tx.get("category_id"))
                key = category["id"] if category else None
                per_cat[key] = per_cat.get(key, 0.0) + value
                if category:
                    per_group[category["group"]] += value
        previous_value = month_portion(tx, previous)
        if previous_value is not None:
            prev_count += 1
            if tx["type"] == "receita":
                prev_income += previous_value
            else:
                prev_expense += previous_value
    slices = [CategorySlice(category_id=key,
        name=cats[key]["name"] if key in cats else "Sem categoria",
        color=cats[key]["color"] if key in cats else "#94A3B8",
        icon=cats[key]["icon"] if key in cats else "more-horizontal",
        total=round(total, 2), percent=round(total / expense * 100, 1) if expense else 0)
        for key, total in sorted(per_cat.items(), key=lambda item: -item[1])]
    rules = []
    for group in SHARES:
        spent = round(per_group[group], 2)
        limit = round(income * SHARES[group], 2)
        percent = round(spent / limit * 100, 1) if limit else (101 if spent else 0)
        rules.append(RuleItem(key=group, label=LABELS[group], spent=spent,
            limit=limit, percent=percent,
            status="dentro" if percent <= 80 else "proximo" if percent <= 100 else "acima"))
    recent = sorted((tx for tx in view["transactions"] if tx["date"][:7] == m),
                    key=lambda tx: (tx["date"], str(tx.get("created_at", ""))), reverse=True)[:6]
    return DashboardOut(month=m, total_balance=round(total_balance, 2),
        income=round(income, 2), expense=round(expense, 2),
        month_balance=round(income - expense, 2),
        prev_income=round(prev_income, 2) if prev_count else None,
        prev_expense=round(prev_expense, 2) if prev_count else None,
        invested=0, categories=slices, rule=rules,
        recent=[enriched_transaction(tx, view) for tx in recent])
