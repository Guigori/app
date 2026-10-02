"""Assinaturas: derived from the user's fixed monthly expenses — no separate entity, so
nothing here can drift from the transactions the user actually registered."""

from datetime import date
from typing import List

from fastapi import APIRouter, Depends

from lib.cards import _clamp_day  # same day-clamping rule as the card cycles
from lib.db import db
from lib.dates import today_iso
from models.notify import SubscriptionItem, SubscriptionsOut
from routers.auth import require_user

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


def _next_charge(day: int, today: date) -> str:
    """Next occurrence of a monthly charge that happens on `day`."""
    this_month = _clamp_day(today.year, today.month, day)
    if this_month >= today:
        return this_month.isoformat()
    year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    return _clamp_day(year, month, day).isoformat()


@router.get("", response_model=SubscriptionsOut)
async def list_subscriptions(user: dict = Depends(require_user)) -> SubscriptionsOut:
    today = date.fromisoformat(today_iso())
    txs = await db.transactions.find(
        {"user_id": user["id"], "type": "despesa", "fixed": True}
    ).sort("date", -1).to_list(2000)
    accounts = {a["id"]: a for a in await db.accounts.find({"user_id": user["id"]}).to_list(500)}
    categories = {c["id"]: c for c in await db.categories.find({"user_id": user["id"]}).to_list(500)}
    cards = {c["id"]: c for c in await db.cards.find({"user_id": user["id"]}).to_list(200)}

    # One entry per recurring name: the most recent occurrence defines the current price.
    seen: dict[str, SubscriptionItem] = {}
    for tx in txs:
        key = tx["name"].strip().lower()
        if key in seen:
            continue
        category = categories.get(tx.get("category_id") or "", {})
        card = cards.get(tx.get("card_id") or "", {})
        seen[key] = SubscriptionItem(
            id=tx["id"],
            name=tx["name"],
            value=round(float(tx["value"]), 2),
            category_id=tx.get("category_id"),
            category_name=category.get("name"),
            category_color=category.get("color"),
            account_id=tx["account_id"],
            account_name=accounts.get(tx["account_id"], {}).get("name", ""),
            card_id=tx.get("card_id"),
            card_name=card.get("name"),
            recurrence=tx.get("recurrence") or "mensal",
            next_charge=_next_charge(int(tx["date"][8:10]), today),
            active=True,
        )

    items = sorted(seen.values(), key=lambda i: -i.value)
    monthly = round(sum(i.value for i in items), 2)

    month = today_iso()[:7]
    incomes = await db.transactions.find(
        {"user_id": user["id"], "type": "receita", "date": {"$regex": f"^{month}"}}
    ).to_list(500)
    income = round(sum(float(t["value"]) for t in incomes), 2)

    return SubscriptionsOut(
        items=items,
        monthly_total=monthly,
        yearly_total=round(monthly * 12, 2),
        income_percent=round(monthly / income * 100, 1) if income else 0.0,
    )
