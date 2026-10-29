"""FIINT v1: explainable, read-only financial tracking maturity.

No behavioural profiling or financial health score. This index measures
whether the user's records are configured consistently across D1..12 months.
Cash totals use the canonical FinancialWindow with exact cent semantics.
"""
from datetime import date
from finnos.lib.money import cents
from finnos.lib.stats import add_months


def fiint_report(*, today: date, monthly: list[dict], accounts: list[dict],
                 categories: list[dict], budget_cycles: list[dict],
                 subscriptions: list[dict]) -> dict:
    if len(monthly) != 12 or len({row["month"] for row in monthly}) != 12:
        raise ValueError("FIINT exige doze competências únicas.")
    # Only real settled movements count toward history maturity; future
    # projections must never masquerade as confirmed evidence.
    activity = [row for row in monthly if row["count"] > 0]
    earliest = activity[0]["month"] if activity else None
    if earliest:
        first_y, first_m = map(int, earliest.split("-"))
        observed = min(12, (today.year - first_y) * 12 + today.month - first_m + 1)
    else:
        observed = 0
    active_accounts = sum(1 for acc in accounts if acc.get("active", True))
    active_subs = sum(1 for sub in subscriptions if sub.get("active", True))
    today_s = today.isoformat()
    has_budget = any(
        cycle.get("start_date", "9999") <= today_s <= cycle.get("end_date", "")
        and not cycle.get("closed_at") for cycle in budget_cycles
    )
    has_recent = any(
        row["count"] > 0 for row in monthly[-3:]
    )
    checks = [
        ("accounts", "Configurar pelo menos uma conta ativa", active_accounts > 0, 20),
        ("categories", "Cadastrar categorias de movimentação", len(categories) > 0, 10),
        ("transactions", "Registrar movimentações confirmadas recentes", has_recent, 20),
        ("budget", "Definir orçamento para o período atual", has_budget, 20),
        ("history", "Acompanhar movimentações em três meses distintos", len(activity) >= 3, 20),
        ("recurrence", "Organizar compromissos ou assinaturas recorrentes", active_subs > 0, 10),
    ]
    score = sum(points for _, _, done, points in checks if done)
    series = []
    for row in monthly:
        series.append({
            "month": row["month"],
            "income": row["income"],
            "expense": row["expense"],
            "net": row["net"],
            "entries": row["count"],
            "has_confirmed_data": row["count"] > 0,
        })
    return {
        "version": "fiint-v1",
        "status": "read_only",
        "score": score,
        "score_label": "Completude do acompanhamento",
        "score_max": 100,
        "maturity_month": max(1, observed),
        "months_observed": len(activity),
        "history_span_months": observed,
        "stage": "D1" if observed == 0 else f"M{observed}",
        "history_start": earliest,
        "criteria": [
            {"id": key, "label": label, "completed": done, "points": points}
            for key, label, done, points in checks
        ],
        "monthly_history": series,
        "data_quality": {
            "active_accounts": active_accounts,
            "categories": len(categories),
            "months_with_settled_records": len(activity),
            "active_subscriptions": active_subs,
            "has_open_budget": has_budget,
        },
        "is_financial_health_score": False,
        "writes_data": False,
        "disclaimer": (
            "O índice avalia a organização dos registros, não recomenda "
            "investimentos nem atesta saúde ou solvência financeira."
        ),
    }


def fiint_months(today: date) -> list[str]:
    month = today.isoformat()[:7]
    return [add_months(month, offset) for offset in range(-11, 1)]
