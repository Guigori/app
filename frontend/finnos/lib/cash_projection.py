"""FIN-07/08/13/14: one read-only, cent-exact 30-day bank cash forecast.

This is not the realized bank ledger: it adds *unsettled* future bank
movements, future fixed sources and non-card subscriptions. Credit card
purchases are excluded, as they are paid through invoice due dates.
"""
import calendar
from collections import defaultdict
from datetime import date
from finnos.lib.money import cents, installment_portion, remaining_installment_indices
from finnos.lib.recurrence import monthly_projection_sources
from finnos.lib.subscription_projection import planned_subscriptions


def _month(year: int, month: int, offset: int):
    index = year * 12 + month - 1 + offset
    return divmod(index, 12)


def project_scheduled_cash(
    transactions: list[dict], opening_cents: int,
    start: date, end: date, subscriptions: list[dict] | None = None,
) -> dict:
    if (type(opening_cents) is not int or end < start
            or (end - start).days > 366):
        raise ValueError("Janela de projeção financeira inválida.")
    sums = defaultdict(int)
    count = 0

    def include(when: date, amount: int):
        nonlocal count
        if start <= when <= end:
            sums[when.isoformat()] += amount
            count += 1

    for tx in transactions:
        if (tx.get("card_id") or tx.get("invoice_payment")
                or tx.get("type") not in ("receita", "despesa")
                or tx.get("status") not in ("pendente", "agendado")):
            continue
        multiplier = 1 if tx["type"] == "receita" else -1
        anchor = date.fromisoformat(tx["date"])
        if not tx.get("installment"):
            include(anchor, multiplier * cents(tx["value"]))
            continue
        indices = remaining_installment_indices(tx)
        for offset, index in enumerate(indices):
            year, month_index = _month(anchor.year, anchor.month, offset)
            target_month = month_index + 1
            when = date(year, target_month, min(
                anchor.day, calendar.monthrange(year, target_month)[1],
            ))
            if when > end:
                break
            include(when, multiplier * cents(installment_portion(tx, index)))

    first_index = start.year * 12 + start.month - 1
    last_index = end.year * 12 + end.month - 1
    for month_index in range(first_index, last_index + 1):
        month = f"{month_index // 12:04d}-{month_index % 12 + 1:02d}"
        for source, when in monthly_projection_sources(transactions, month):
            if source.get("card_id"):
                continue
            sign = 1 if source["type"] == "receita" else -1
            include(date.fromisoformat(when), sign * cents(source["value"]))
        if subscriptions:
            for sub, when in planned_subscriptions(
                subscriptions, transactions, month, start.isoformat(),
            ):
                if sub.get("card_id"):
                    continue
                include(when, -cents(sub["value"]))

    running = opening_cents
    first_negative = None
    for when in sorted(sums):
        running += sums[when]
        if running < 0 and first_negative is None:
            first_negative = when
    return {
        "opening_cents": opening_cents,
        "projected_cents": running,
        "first_negative_date": first_negative,
        "event_count": count,
        "daily_deltas_cents": dict(sorted(sums.items())),
    }
