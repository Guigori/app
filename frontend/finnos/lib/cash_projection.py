"""FIN-07/08/13/14: one read-only, cent-exact 30-day bank cash forecast.

This is not the realized bank ledger: it adds *unsettled* future bank
movements, the not-yet-due installments of paid bank purchases, future fixed
sources and non-card subscriptions. Credit card purchases enter only through
their invoices: when `cards` is given, each open invoice balance falls on its
due date (an overdue one on `start`). Radar and Simulação share this ledger so
the same debt can never appear in one screen and vanish in the other (AUD-03).

`opening_cents` must be the realized balance as of `start` (see
stats.balance_effects), so installments dated on `start` are already in it.
"""
from collections import defaultdict
from datetime import date
from finnos.lib.money import cents, installment_portion, installment_schedule
from finnos.lib.recurrence import monthly_projection_sources
from finnos.lib.subscription_projection import planned_subscriptions


def project_scheduled_cash(
    transactions: list[dict], opening_cents: int,
    start: date, end: date, subscriptions: list[dict] | None = None,
    cards: list[dict] | None = None,
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
        if (tx.get("card_id") or (tx.get("invoice_payment") or tx.get("balance_adjustment"))
                or tx.get("type") not in ("receita", "despesa")):
            continue
        multiplier = 1 if tx["type"] == "receita" else -1
        if tx.get("status") == "pago":
            # Realized up to `start`; only later installments are still to come.
            if tx.get("installment") and tx.get("date", "") <= start.isoformat():
                for when, index in installment_schedule(tx):
                    if when > start.isoformat():
                        include(date.fromisoformat(when), multiplier * cents(installment_portion(tx, index)))
            continue
        if tx.get("status") not in ("pendente", "agendado"):
            continue
        if not tx.get("installment"):
            include(date.fromisoformat(tx["date"]), multiplier * cents(tx["value"]))
            continue
        for when, index in installment_schedule(tx):
            include(date.fromisoformat(when), multiplier * cents(installment_portion(tx, index)))

    for card in cards or []:
        from finnos.lib.invoices import invoice_state, occurrences

        # Legacy cards without a valid cycle cannot date an invoice; the
        # historical review reports them as uninspectable instead.
        if not all(type(card.get(key)) is int and 1 <= card[key] <= 31
                   for key in ("closing_day", "due_day")):
            continue
        cycles = {key for tx in transactions for key, _, _ in occurrences(card, tx)}
        cycles |= set(card.get("invoice_cycles") or {})
        for cycle in sorted(cycles):
            state = invoice_state(card, transactions, cycle)
            outstanding = state["total_cents"] - state["paid_cents"]
            due = date.fromisoformat(state["due_date"])
            if outstanding > 0 and due <= end:
                include(max(due, start), -outstanding)

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
