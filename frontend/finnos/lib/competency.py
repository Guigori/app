"""FIN-08: one financial competency calculation for all FINNOS consumers.

Purchases are expenses by competency month. Bank movements for invoice
payments/refunds affect cash balances only, never income/expense totals.
Merchant credits and bank refunds reverse the original purchase category
on the date the compensation is recorded, not on the original invoice date.
All source money is reconciled in integer cents.
"""
from collections import defaultdict
from decimal import Decimal

from finnos.lib.money import D, cents
from finnos.lib.stats import month_portion


def credit_events(cards: list[dict], txs: list[dict]) -> list[dict]:
    originals = {tx["id"]: tx for tx in txs}
    events = []
    seen = set()
    for card in cards:
        for kind, ledger, field in (
            ("merchant_credit", card.get("invoice_adjustments") or {}, "credit_cents"),
            ("bank_refund", card.get("invoice_refunds") or {}, "refund_cents"),
        ):
            for cycle, entries in ledger.items():
                for entry in entries:
                    identifier = (card["id"], kind, entry["id"])
                    if identifier in seen:
                        continue
                    seen.add(identifier)
                    original = originals.get(entry["purchase_id"])
                    if original is None:
                        # An orphaned adjustment must be reported by finance
                        # integrity checks, not assigned to a random category.
                        continue
                    events.append({
                        "id": entry["id"],
                        "kind": kind,
                        "cycle": cycle,
                        "purchase_id": entry["purchase_id"],
                        "category_id": original.get("category_id"),
                        "card_id": card["id"],
                        "date": entry["date"],
                        "cents": int(entry[field]),
                    })
    return events


def monthly_competency(txs: list[dict], cards: list[dict], month: str) -> dict:
    income = expense = 0
    categories = defaultdict(int)
    for tx in txs:
        value = month_portion(tx, month)
        if value is None:
            continue
        portion = cents(value)
        if tx["type"] == "receita":
            income += portion
        elif tx["type"] == "despesa":
            expense += portion
            categories[tx.get("category_id")] += portion
    credits = [entry for entry in credit_events(cards, txs) if entry["date"][:7] == month]
    for event in credits:
        expense -= event["cents"]
        categories[event["category_id"]] -= event["cents"]
    return {
        "income": D(income) / 100,
        "expense": D(expense) / 100,
        "net": D(income - expense) / 100,
        "by_category": {key: D(value) / 100 for key, value in categories.items()},
        "credit_events": credits,
    }


def positive_category_slices(by_category: dict) -> list[tuple]:
    """Nonnegative weights for expense pies, separate from signed net expense.

    Refunds may make a category negative within a calendar month. Financial
    totals must retain that negative value, but Recharts SVG pie segments
    cannot display negative wedges or percentages based on a negative total.
    Only positive net categories enter the donut; history/budget remain signed.
    """
    rows = [(category_id, D(amount)) for category_id, amount in by_category.items()
            if D(amount) > 0]
    denominator = sum((amount for _, amount in rows), D(0))
    if denominator <= 0:
        return []
    return [(category_id, amount, round(amount * 100 / denominator, 1))
            for category_id, amount in sorted(rows, key=lambda row: -row[1])]
