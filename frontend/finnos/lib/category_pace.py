"""FINN-inspired category monthly spending pace, using integer cents.

The FINN reference is analytics.ts::pace; the FINNOS implementation keeps its
own paid/pending semantics and does not treat future-dated entries as settled.
"""
from calendar import monthrange
from datetime import date
from decimal import Decimal
from finnos.lib.money import cents
from finnos.lib.stats import month_portion


def monthly_pace(limit, transactions, category_id, month, as_of=None, credits=None):
    year, month_num = map(int, month.split("-"))
    days = monthrange(year, month_num)[1]
    as_of = as_of or date.today()
    if isinstance(as_of, str):
        as_of = date.fromisoformat(as_of)
    current_index = as_of.year * 12 + as_of.month
    target_index = year * 12 + month_num
    day = 0 if target_index > current_index else days if target_index < current_index else as_of.day
    cumulative = [0] * (days + 1)
    for tx in transactions:
        if tx.get("category_id") != category_id or tx.get("type") != "despesa" or tx.get("invoice_payment"):
            continue
        value = month_portion(tx, month)
        if value is None:
            continue
        # For installment k/n, the purchase date is the first remaining
        # installment; subsequent months use the same day, clamped to month end.
        tx_day = min(int(str(tx["date"])[8:10]), days)
        occurrence = date(year, month_num, tx_day)
        if occurrence > as_of:
            continue
        cumulative[tx_day] += cents(value)
    for credit in credits or []:
        if credit.get("category_id") != category_id or str(credit.get("date", ""))[:7] != month:
            continue
        day_of_month = int(credit["date"][8:10])
        if date(year, month_num, day_of_month) <= as_of:
            cumulative[day_of_month] -= credit["cents"]
    for i in range(1, len(cumulative)):
        cumulative[i] += cumulative[i-1]
    spent = cumulative[day]
    limit_cents = cents(limit)
    remaining = max(0, limit_cents - spent)
    ideal = (limit_cents * day + days // 2) // days
    remaining_days = days - day
    return {
        "limit_cents": limit_cents,
        "spent_cents": spent,
        "available_cents": remaining,
        "ideal_cents": ideal,
        "diff_from_ideal_cents": ideal - spent,
        "daily_allowance_cents": remaining // remaining_days if remaining_days else 0,
        "projected_month_end_cents": (spent * days + day // 2) // day if day else 0,
        "day": day,
        "days_in_month": days,
        "cumulative_cents": cumulative,
    }
