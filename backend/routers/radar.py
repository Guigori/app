"""FINNOS Radar — deterministic, dynamic signals. No LLM is required.

Signals are recomputed from current financial data on every request. When the
underlying condition is resolved (invoice closes/gets paid, budget returns to
normal, etc.) the signal naturally disappears and higher-ranked/new signals
take its place.
"""
from datetime import date
from fastapi import APIRouter, Depends

from lib.db import db
from lib.dates import today_iso
from lib.stats import add_months, month_portion
from calendar import monthrange
from models.radar import RadarOut, RadarSignalOut
from routers.auth import require_user
from routers.cards import _build as build_card, _context as card_context

router = APIRouter(prefix="/radar", tags=["radar"])

POSITIONS = [326, 34, 92, 178, 232, 286, 138]

def brl(value: float) -> str:
    raw = f"{value:,.2f}"
    return "R$ " + raw.replace(",", "X").replace(".", ",").replace("X", ".")

def days_until(iso: str) -> int:
    return (date.fromisoformat(iso) - date.fromisoformat(today_iso())).days

def month_end(month: str) -> str:
    year, mon = map(int, month.split("-"))
    return f"{month}-{monthrange(year, mon)[1]:02d}"

@router.get("", response_model=RadarOut)
async def radar(user: dict = Depends(require_user)) -> RadarOut:
    user_id = user["id"]
    today = today_iso()
    month = today[:7]
    prev_month = add_months(month, -1)
    signals: list[dict] = []

    txs = await db.transactions.find({"user_id": user_id}).to_list(20000)
    categories = await db.categories.find({"user_id": user_id}).to_list(500)
    cat_by_id = {c["id"]: c for c in categories}

    # Category pace: compare current month with previous month up to the same
    # day-of-month. Require a meaningful baseline to avoid noisy percentages.
    current_by_cat: dict[str, float] = {}
    previous_by_cat: dict[str, float] = {}
    day = int(today[8:10])
    for tx in txs:
        if tx.get("type") != "despesa" or tx.get("status") != "pago":
            continue
        cid = tx.get("category_id")
        if not cid:
            continue
        portion = month_portion(tx, month)
        if portion is not None and tx["date"] <= today:
            current_by_cat[cid] = current_by_cat.get(cid, 0.0) + portion
        prev = month_portion(tx, prev_month)
        if prev is not None and int(tx["date"][8:10]) <= day:
            previous_by_cat[cid] = previous_by_cat.get(cid, 0.0) + prev

    for cid, current in current_by_cat.items():
        previous = previous_by_cat.get(cid, 0.0)
        if previous < 50 or current <= previous * 1.20:
            continue
        pct = round((current / previous - 1) * 100)
        cat = cat_by_id.get(cid, {})
        severity = "high" if pct >= 50 else "medium"
        signals.append({
            "id": f"category-pace-{cid}-{month}",
            "type": "deviation", "severity": severity,
            "title": f"{cat.get('name', 'Categoria')} acelerou este mês",
            "description": f"+{pct}% comparado ao mesmo período do mês anterior",
            "metric": f"+{pct}%", "score": 65 + min(pct, 80) / 4,
            "related_entity_type": "category", "related_entity_id": cid,
            "expires_at": month_end(month),
        })

    # Category budgets: explicit user budgets are stronger than historical pace.
    for cid, current in current_by_cat.items():
        cat = cat_by_id.get(cid, {})
        budget = float(cat.get("monthly_budget") or 0)
        if budget <= 0:
            continue
        pct = current / budget * 100
        if pct < 85:
            continue
        critical = pct >= 100
        signals.append({
            "id": f"category-budget-{cid}-{month}",
            "type": "risk", "severity": "critical" if critical else "high",
            "title": f"{cat.get('name', 'Categoria')} {'passou' if critical else 'está perto'} do orçamento",
            "description": f"{brl(current)} de {brl(budget)} planejados neste mês",
            "metric": f"{round(pct)}%", "score": 96 if critical else 84,
            "related_entity_type": "category", "related_entity_id": cid,
            "expires_at": month_end(month),
        })

    # Cards: closing proximity + invoice pressure against card limit.
    card_docs = await db.cards.find({"user_id": user_id, "active": True}).to_list(200)
    card_txs, accounts = await card_context(user_id)
    for doc in card_docs:
        card = await build_card(doc, card_txs, accounts)
        close_days = days_until(card.next_closing)
        if 0 <= close_days <= 4 and not card.invoice_paid:
            if card.used_percent >= 85:
                critical = card.used_percent >= 100
                signals.append({
                    "id": f"card-pressure-{card.id}-{card.next_closing}",
                    "type": "risk", "severity": "critical" if critical else "high",
                    "title": f"Fatura {card.name} acima do planejado",
                    "description": f"{brl(card.current_invoice)} até agora · fecha em {close_days} dia{'s' if close_days != 1 else ''}",
                    "metric": f"{round(card.used_percent)}%", "score": 100 if critical else 90,
                    "related_entity_type": "card", "related_entity_id": card.id,
                    "expires_at": card.next_closing,
                })
            else:
                signals.append({
                    "id": f"card-closing-{card.id}-{card.next_closing}",
                    "type": "information", "severity": "normal",
                    "title": f"Cartão {card.name} fecha em {close_days} dia{'s' if close_days != 1 else ''}",
                    "description": "Compras após o fechamento irão para a próxima fatura",
                    "score": 48 + (4 - close_days) * 2,
                    "related_entity_type": "card", "related_entity_id": card.id,
                    "expires_at": card.next_closing,
                })
        if card.future_installments >= 500:
            signals.append({
                "id": f"card-future-{card.id}-{month}",
                "type": "information", "severity": "normal",
                "title": f"{brl(card.future_installments)} já comprometidos no {card.name}",
                "description": "Parcelas futuras já ocupam parte do seu limite",
                "score": 42,
                "related_entity_type": "card", "related_entity_id": card.id,
                "expires_at": month_end(month),
            })

    # Opportunity: meaningful positive month balance, shown only once the month
    # has enough activity to avoid congratulating an empty/new account.
    income = expense = 0.0
    activity = 0
    for tx in txs:
        portion = month_portion(tx, month)
        if portion is None or tx.get("status") != "pago":
            continue
        activity += 1
        if tx.get("type") == "receita": income += portion
        elif tx.get("type") == "despesa": expense += portion
    surplus = income - expense
    if activity >= 5 and income > 0 and surplus >= max(income * .15, 200):
        signals.append({
            "id": f"monthly-surplus-{month}",
            "type": "opportunity", "severity": "normal",
            "title": f"Você tem {brl(surplus)} de saldo positivo no mês",
            "description": "Uma parte pode ser direcionada para metas ou investimentos",
            "score": 38,
            "expires_at": month_end(month),
        })

    # Deduplicate same entity/topic pressure: budget risk outranks pace deviation.
    budget_entities = {s["related_entity_id"] for s in signals if s["id"].startswith("category-budget-")}
    signals = [s for s in signals if not (s["id"].startswith("category-pace-") and s["related_entity_id"] in budget_entities)]
    signals.sort(key=lambda s: (-s["score"], s["id"]))
    for i, signal in enumerate(signals):
        signal["radar_position"] = POSITIONS[i % len(POSITIONS)]

    items = [RadarSignalOut(**s) for s in signals]
    return RadarOut(items=items, count=len(items))
