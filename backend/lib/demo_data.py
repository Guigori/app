"""FINNOS demo dataset.

Two callers, one guarantee — the data is clearly substitutable and never mixes
with a real user's records:
- seed.py creates the standalone demo account (demo@finnos.app / demo1234);
- POST /api/demo/load replaces the signed-in user's financial records with this dataset.
"""

from __future__ import annotations

import calendar
import uuid
from datetime import datetime, timezone

from lib.db import db
from lib.stats import add_months, today_date

# (name, icon, color, group, monthly_budget, monthly_goal)
DEFAULT_CATEGORIES: list[dict] = [
    {"name": "Alimentação", "icon": "utensils", "color": "#F59E0B", "group": "necessidades", "monthly_budget": 900, "monthly_goal": 0},
    {"name": "Mercado", "icon": "shopping-cart", "color": "#84CC16", "group": "necessidades", "monthly_budget": 600, "monthly_goal": 0},
    {"name": "Moradia", "icon": "home", "color": "#070F52", "group": "necessidades", "monthly_budget": 1600, "monthly_goal": 0},
    {"name": "Transporte", "icon": "car", "color": "#06B6D4", "group": "necessidades", "monthly_budget": 400, "monthly_goal": 0},
    {"name": "Saúde", "icon": "heart-pulse", "color": "#10B981", "group": "necessidades", "monthly_budget": 300, "monthly_goal": 0},
    {"name": "Educação", "icon": "graduation-cap", "color": "#6366F1", "group": "necessidades", "monthly_budget": 350, "monthly_goal": 0},
    {"name": "Lazer", "icon": "gamepad-2", "color": "#8B5CF6", "group": "desejos", "monthly_budget": 300, "monthly_goal": 0},
    {"name": "Restaurantes", "icon": "coffee", "color": "#F97316", "group": "desejos", "monthly_budget": 250, "monthly_goal": 0},
    {"name": "Compras", "icon": "shopping-bag", "color": "#EC4899", "group": "desejos", "monthly_budget": 300, "monthly_goal": 0},
    {"name": "Assinaturas", "icon": "repeat", "color": "#F43F5E", "group": "desejos", "monthly_budget": 150, "monthly_goal": 0},
    {"name": "Viagem", "icon": "plane", "color": "#0EA5E9", "group": "desejos", "monthly_budget": 200, "monthly_goal": 0},
    {"name": "Investimentos", "icon": "trending-up", "color": "#059669", "group": "metas", "monthly_budget": 1000, "monthly_goal": 0},
    {"name": "Metas", "icon": "piggy-bank", "color": "#7C3AED", "group": "metas", "monthly_budget": 400, "monthly_goal": 0},
    {"name": "Renda", "icon": "wallet", "color": "#047857", "group": "necessidades", "monthly_budget": 0, "monthly_goal": 0},
    {"name": "Outros", "icon": "more-horizontal", "color": "#64748B", "group": "desejos", "monthly_budget": 0, "monthly_goal": 0},
]

# (name, institution, type, color, initial_balance)
DEMO_ACCOUNTS: list[dict] = [
    {"name": "Nubank", "institution": "Nubank", "type": "digital", "color": "#8A05BE", "initial_balance": 4000.0},
    {"name": "Inter", "institution": "Banco Inter", "type": "digital", "color": "#FF7A00", "initial_balance": 450.0},
    {"name": "Itaú", "institution": "Itaú Unibanco", "type": "corrente", "color": "#EC7000", "initial_balance": 1800.0},
    {"name": "Carteira", "institution": "Dinheiro", "type": "carteira", "color": "#64748B", "initial_balance": 300.0},
]


def _day(month: str, day: int) -> str:
    y, m = int(month[:4]), int(month[5:7])
    return f"{month}-{min(day, calendar.monthrange(y, m)[1]):02d}"


def demo_transactions(now: datetime) -> list[dict]:
    """Current + previous month, anchored to the server clock — so month-over-month
    comparisons are real, never fabricated."""
    m0 = today_date().strftime("%Y-%m")
    m1 = add_months(m0, -1)

    def tx(name, value, ttype, account_key, category_key, month, day, status="pago", **extra):
        return {
            "id": str(uuid.uuid4()),
            "name": name,
            "value": value,
            "type": ttype,
            "account_key": account_key,
            "category_key": category_key,
            "date": _day(month, day),
            "status": status,
            "created_at": now,
            "updated_at": now,
            **extra,
        }

    return [
        # --- current month ---
        tx("Salário", 5200.00, "receita", "Itaú", "Renda", m0, 5),
        tx("Aluguel", 1450.00, "despesa", "Itaú", "Moradia", m0, 5, fixed=True, recurrence="mensal"),
        tx("Internet fibra", 99.90, "despesa", "Itaú", "Moradia", m0, 8, fixed=True, recurrence="mensal"),
        tx("Mercado do mês", 212.40, "despesa", "Nubank", "Mercado", m0, 3),
        tx("Feira da semana", 189.90, "despesa", "Nubank", "Mercado", m0, 12),
        tx("Compras rápidas", 143.75, "despesa", "Nubank", "Mercado", m0, 21),
        tx("Uber trabalho", 38.60, "despesa", "Nubank", "Transporte", m0, 6),
        tx("Combustível", 52.30, "despesa", "Nubank", "Transporte", m0, 24),
        tx("Academia", 89.90, "despesa", "Nubank", "Saúde", m0, 10, fixed=True, recurrence="mensal"),
        tx("Netflix", 44.90, "despesa", "Nubank", "Assinaturas", m0, 12, fixed=True, recurrence="mensal"),
        tx("Spotify", 21.90, "despesa", "Inter", "Assinaturas", m0, 15, fixed=True, recurrence="mensal"),
        tx("Cinema", 55.00, "despesa", "Nubank", "Lazer", m0, 20),
        tx("MacBook", 600.00, "despesa", "Nubank", "Compras", add_months(m0, -2), 14,
           installment=True, total_installments=10, current_installment=3, installment_value=600.00),
        tx("Transferência para o Nubank", 500.00, "transferencia", "Itaú", None, m0, 7, to_account_key="Nubank"),
        tx("Conta de luz", 186.70, "despesa", "Itaú", "Moradia", m0, 25, status="agendado"),
        tx("Farmácia", 68.40, "despesa", "Carteira", "Saúde", m0, 8, status="pendente"),
        # --- previous month (keeps the month-over-month comparison honest) ---
        tx("Salário", 5200.00, "receita", "Itaú", "Renda", m1, 5),
        tx("Freelance", 800.00, "receita", "Inter", "Renda", m1, 18),
        tx("Aluguel", 1450.00, "despesa", "Itaú", "Moradia", m1, 5, fixed=True, recurrence="mensal"),
        tx("Internet fibra", 99.90, "despesa", "Itaú", "Moradia", m1, 8, fixed=True, recurrence="mensal"),
        tx("Mercado do mês", 260.10, "despesa", "Nubank", "Mercado", m1, 3),
        tx("Feira da semana", 231.85, "despesa", "Nubank", "Mercado", m1, 12),
        tx("Compras rápidas", 158.40, "despesa", "Nubank", "Mercado", m1, 21),
        tx("Uber trabalho", 71.20, "despesa", "Nubank", "Transporte", m1, 6),
        tx("Combustível", 84.70, "despesa", "Nubank", "Transporte", m1, 24),
        tx("Academia", 89.90, "despesa", "Nubank", "Saúde", m1, 10, fixed=True, recurrence="mensal"),
        tx("Netflix", 44.90, "despesa", "Nubank", "Assinaturas", m1, 12, fixed=True, recurrence="mensal"),
        tx("Spotify", 21.90, "despesa", "Inter", "Assinaturas", m1, 15, fixed=True, recurrence="mensal"),
        tx("Cinema com amigos", 92.00, "despesa", "Nubank", "Lazer", m1, 20),
        tx("Curso de inglês", 249.00, "despesa", "Itaú", "Educação", m1, 9),
    ]


async def insert_default_categories(user_id: str) -> None:
    now = datetime.now(timezone.utc)
    await db.categories.insert_many(
        [{**c, "id": str(uuid.uuid4()), "user_id": user_id, "created_at": now} for c in DEFAULT_CATEGORIES]
    )


async def load_demo_for_user(user_id: str) -> None:
    """Replace ALL of the user's financial records with the demo dataset."""
    now = datetime.now(timezone.utc)
    for collection in ("transactions", "accounts", "categories"):
        await db[collection].delete_many({"user_id": user_id})

    await insert_default_categories(user_id)
    cats = await db.categories.find({"user_id": user_id}).to_list(100)
    cat_by_name = {c["name"]: c["id"] for c in cats}

    accounts = [{**a, "id": str(uuid.uuid4()), "user_id": user_id, "created_at": now} for a in DEMO_ACCOUNTS]
    await db.accounts.insert_many(accounts)
    acc_by_name = {a["name"]: a["id"] for a in accounts}

    txs = []
    for t in demo_transactions(now):
        t["user_id"] = user_id
        t["account_id"] = acc_by_name[t.pop("account_key")]
        to_key = t.pop("to_account_key", None)
        t["to_account_id"] = acc_by_name[to_key] if to_key else None
        cat_key = t.pop("category_key", None)
        t["category_id"] = cat_by_name.get(cat_key) if cat_key else None
        txs.append(t)
    if txs:
        await db.transactions.insert_many(txs)
