"""First-class, UID-scoped subscriptions. A subscription is a plan, not a bank debit.

Previously this endpoint mixed *every* fixed expense with subscriptions.
Legacy fixed transactions remain intact in Flow but are not silently converted.
"""
import calendar
import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, Header
from pydantic import Field

from finnos.lib.db import db
from finnos.lib.dates import today_iso
from finnos.lib.money import D, FinanceModel, Money
from finnos.models.notify import SubscriptionItem, SubscriptionsOut
from finnos.routers.auth import require_user

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


class SubscriptionIn(FinanceModel):
    name: str = Field(min_length=1, max_length=100)
    value: Money = Field(gt=0)
    recurrence: Literal["mensal", "anual"] = "mensal"
    next_charge: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    account_id: str = Field(min_length=1, max_length=1500)
    category_id: str | None = None
    card_id: str | None = None
    active: bool = True
    notes: str | None = Field(default=None, max_length=500)


def _money(value):
    return D(value).quantize(D("0.01"), rounding=ROUND_HALF_UP)


def _charge_day(start: date, recurrence: str, today: date) -> str:
    """Project the next payment; never rewrite the original billing anchor."""
    if start >= today:
        return start.isoformat()
    if recurrence == "anual":
        year = today.year
        next_date = date(year, start.month, min(start.day, calendar.monthrange(year, start.month)[1]))
        if next_date < today:
            year += 1
            next_date = date(year, start.month, min(start.day, calendar.monthrange(year, start.month)[1]))
        return next_date.isoformat()
    difference = max(0, (today.year - start.year) * 12 + today.month - start.month)
    def with_offset(offset):
        index = start.year * 12 + (start.month - 1) + offset
        year, month = divmod(index, 12)
        return date(year, month + 1, min(start.day, calendar.monthrange(year, month + 1)[1]))
    candidate = with_offset(difference)
    return (with_offset(difference + 1) if candidate < today else candidate).isoformat()


async def _maps(uid: str):
    accounts = {doc["id"]: doc for doc in await db.accounts.find({"user_id": uid}).to_list(500)}
    categories = {doc["id"]: doc for doc in await db.categories.find({"user_id": uid}).to_list(500)}
    cards = {doc["id"]: doc for doc in await db.cards.find({"user_id": uid}).to_list(200)}
    return accounts, categories, cards


def _out(doc, accounts, categories, cards):
    category = categories.get(doc.get("category_id"), {})
    card = cards.get(doc.get("card_id"), {})
    return SubscriptionItem(
        id=doc["id"], name=doc["name"], value=doc["value"],
        recurrence=doc["recurrence"],
        next_charge=_charge_day(date.fromisoformat(doc["next_charge"]), doc["recurrence"], date.fromisoformat(today_iso())),
        active=doc.get("active", True), notes=doc.get("notes"),
        account_id=doc["account_id"],
        account_name=accounts.get(doc["account_id"], {}).get("name", ""),
        category_id=doc.get("category_id"),
        category_name=category.get("name"),
        category_color=category.get("color"),
        card_id=doc.get("card_id"), card_name=card.get("name"),
    )


async def _validate(uid: str, payload: SubscriptionIn):
    try:
        date.fromisoformat(payload.next_charge)
    except ValueError as exc:
        raise HTTPException(422, "Data de próxima cobrança inválida.") from exc
    accounts, categories, cards = await _maps(uid)
    if payload.account_id not in accounts:
        raise HTTPException(400, "Conta da assinatura inválida.")
    if payload.category_id and payload.category_id not in categories:
        raise HTTPException(400, "Categoria da assinatura inválida.")
    if payload.card_id and payload.card_id not in cards:
        raise HTTPException(400, "Cartão da assinatura inválido.")
    return accounts, categories, cards


@router.get("", response_model=SubscriptionsOut)
async def list_subscriptions(user: dict = Depends(require_user)):
    uid = user["id"]
    subscriptions = await db.subscriptions.find({"user_id": uid}).to_list(500)
    accounts, categories, cards = await _maps(uid)
    items = [_out(doc, accounts, categories, cards) for doc in subscriptions]
    items.sort(key=lambda item: (not item.active, item.next_charge, item.name.lower()))

    active = [item for item in items if item.active]
    yearly = _money(sum(
        (D(item.value) * 12 if item.recurrence == "mensal" else D(item.value) for item in active),
        D(0),
    ))
    monthly = _money(yearly / 12)

    month = today_iso()[:7]
    realized_income = await db.transactions.find({
        "user_id": uid, "type": "receita", "status": "pago",
        "date": {"$regex": f"^{month}"},
    }).to_list(20000)
    # A settled card refund is a bank receipt, not recurring salary.
    income = sum((D(tx["value"]) for tx in realized_income
                  if not tx.get("invoice_refund")), D(0))
    percent = _money(monthly / income * 100) if income > 0 else D(0)
    return SubscriptionsOut(
        items=items, monthly_total=monthly, yearly_total=yearly,
        income_percent=percent,
    )


@router.get("/{subscription_id}", response_model=SubscriptionItem)
async def get_subscription(subscription_id: str, user: dict = Depends(require_user)):
    uid = user["id"]
    document = await db.subscriptions.find_one({"user_id": uid, "id": subscription_id})
    if not document:
        raise HTTPException(404, "Assinatura não encontrada.")
    return _out(document, *await _maps(uid))


@router.post("", response_model=SubscriptionItem, status_code=201)
async def create_subscription(payload: SubscriptionIn, user: dict = Depends(require_user), x_finnos_operation_id: str | None = Header(default=None, min_length=1, max_length=80)):
    uid = user["id"]
    maps = await _validate(uid, payload)
    now = datetime.now(timezone.utc)
    document = {
        **payload.model_dump(),
        **({"operation_id": x_finnos_operation_id} if x_finnos_operation_id else {}),
        "id": str(uuid.uuid4()), "user_id": uid,
        "created_at": now, "updated_at": now,
    }
    await db.subscriptions.insert_one(document)
    return _out(document, *maps)


@router.put("/{subscription_id}", response_model=SubscriptionItem)
async def update_subscription(
    subscription_id: str, payload: SubscriptionIn, user: dict = Depends(require_user),
):
    uid = user["id"]
    maps = await _validate(uid, payload)
    result = await db.subscriptions.update_one(
        {"id": subscription_id, "user_id": uid},
        {"$set": {**payload.model_dump(), "updated_at": datetime.now(timezone.utc)}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Assinatura não encontrada.")
    document = await db.subscriptions.find_one({"id": subscription_id, "user_id": uid})
    if not document:
        raise HTTPException(409, "A assinatura mudou durante a edição.")
    return _out(document, *maps)


@router.delete("/{subscription_id}", status_code=204)
async def delete_subscription(subscription_id: str, user: dict = Depends(require_user)):
    result = await db.subscriptions.delete_one({"id": subscription_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Assinatura não encontrada.")
    return Response(status_code=204)
