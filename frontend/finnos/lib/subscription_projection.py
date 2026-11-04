"""FIN-13: deterministic subscription forecasts, never a debit or invoice payment.

A subscription is a plan, and can coexist with imported/manual transactions.
Do not create a second projected expense if a transaction for the subscription
has already been entered, whether as paid, pending, or scheduled. Legacy fixed
transactions with identical billing identity own their own future forecast.
"""
import calendar
from datetime import date

from finnos.lib.money import cents


def _matches_billing(tx: dict, sub: dict) -> bool:
    if tx.get("type") != "despesa" or tx.get("invoice_payment") or tx.get("invoice_refund"):
        return False
    if tx.get("subscription_id") and tx["subscription_id"] == sub.get("id"):
        return True
    if (str(tx.get("name") or "").strip().casefold()
            != str(sub.get("name") or "").strip().casefold()):
        return False
    if tx.get("account_id") != sub.get("account_id"):
        return False
    if (tx.get("card_id") or None) != (sub.get("card_id") or None):
        return False
    if (tx.get("category_id") or None) != (sub.get("category_id") or None):
        return False
    try:
        return cents(tx.get("value", 0)) == cents(sub["value"])
    except (ValueError, TypeError, KeyError):
        return False


def subscription_occurrence(sub: dict, month: str) -> date | None:
    """Billing date for a month, preserving the initial day across February."""
    if not sub.get("active", True):
        return None
    anchor = date.fromisoformat(sub["next_charge"])
    year, number = map(int, month.split("-"))
    idx = year * 12 + number - 1
    anchor_idx = anchor.year * 12 + anchor.month - 1
    if idx < anchor_idx:
        return None
    recurrence = sub.get("recurrence", "mensal")
    if recurrence not in ("mensal", "anual"):
        return None
    if recurrence == "anual" and (idx - anchor_idx) % 12:
        return None
    return date(year, number, min(anchor.day, calendar.monthrange(year, number)[1]))


def planned_subscriptions(
    subscriptions: list[dict],
    txs: list[dict],
    month: str,
    on_or_after: str,
) -> list[tuple[dict, date]]:
    """Projected charges not already covered by user transactions.

    Suppress if an explicit same-month bill exists. For legacy fixed rows,
    suppress matching forecasts for every month rather than count twice.
    """
    result = []
    for sub in subscriptions:
        occurrence = subscription_occurrence(sub, month)
        if occurrence is None or occurrence.isoformat() < on_or_after:
            continue
        if any(_matches_billing(tx, sub) and (
            str(tx.get("date") or "")[:7] == month or tx.get("fixed")
        ) for tx in txs):
            continue
        result.append((sub, occurrence))
    return result


def planned_subscriptions_in_period(
    subscriptions: list[dict], txs: list[dict],
    start: date, end: date, on_or_after: str,
) -> list[tuple[dict, date]]:
    if end < start:
        return []
    first = start.year * 12 + start.month - 1
    last = end.year * 12 + end.month - 1
    out = []
    for index in range(first, last + 1):
        month = f"{index // 12:04d}-{index % 12 + 1:02d}"
        out.extend(
            (sub, charge) for sub, charge in planned_subscriptions(
                subscriptions, txs, month, on_or_after,
            ) if start <= charge <= end
        )
    return out
