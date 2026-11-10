"""Day-by-day balance of the person's accounts in one month.

"Saldo" in the Home chart must be the money in the accounts, the same number as the
"Saldo total" card: it uses balance_effects, the rule behind every account balance.
So a card purchase moves it only when the invoice is paid, a transfer between own
accounts does not move it, and a pending or scheduled entry never does.

Only what already happened is returned (up to today); the estimate after today is
the chart's job, from the calendar's expected entries.
"""
from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException

from finnos.lib.money import D, quantize_brl
from finnos.lib.stats import balance_effects


def _day(value: str) -> date:
    return date.fromisoformat(value)


class CashHistory:
    """Folds transactions one by one; never keeps the rows."""

    def __init__(self, accounts: list[dict], month: str, today: str):
        year, number = map(int, month.split("-"))
        self.month = month
        self.first = f"{month}-01"
        self.last = f"{month}-{monthrange(year, number)[1]:02d}"
        self.today = today
        # Last day whose balance is already real: today, or the end of a past month.
        self.cap = min(today, self.last)
        self.before = (_day(self.first) - timedelta(days=1)).isoformat()
        self.known = {a["id"] for a in accounts}
        self.opening = sum((D(a.get("initial_balance") or "0") for a in accounts), D("0.0"))
        self.deltas: dict[str, Decimal] = defaultdict(lambda: D("0.0"))

    def _sum(self, effects: list[tuple[str, Decimal]]) -> Decimal:
        total = D("0.0")
        for account_id, amount in effects:
            if account_id not in self.known:
                # Same rule as AccountLedger: never a partial balance.
                raise HTTPException(409, "Movimento financeiro vinculado a conta inexistente; conciliação necessária.")
            total += amount
        return total

    def add(self, tx: dict) -> None:
        if self.cap < self.first:
            # A future month: nothing real inside it yet; it starts from today's balance.
            self.opening += self._sum(balance_effects(tx, self.today))
            return
        if tx.get("installment"):
            # Parcelado on an account: each installment moves the balance on its own date.
            previous = self._sum(balance_effects(tx, self.before))
            self.opening += previous
            current_day = _day(self.first)
            end = _day(self.cap)
            while current_day <= end:
                key = current_day.isoformat()
                now = self._sum(balance_effects(tx, key))
                if now != previous:
                    self.deltas[key] += now - previous
                    previous = now
                current_day += timedelta(days=1)
            return
        amount = self._sum(balance_effects(tx, self.cap))
        if not amount:
            return
        if tx["date"] < self.first:
            self.opening += amount
        else:
            self.deltas[tx["date"]] += amount

    def result(self) -> dict:
        days = []
        balance = self.opening
        if self.cap >= self.first:
            current_day = _day(self.first)
            end = _day(self.cap)
            while current_day <= end:
                key = current_day.isoformat()
                balance += self.deltas.get(key, D("0.0"))
                days.append({"date": key, "balance": quantize_brl(balance)})
                current_day += timedelta(days=1)
        return {
            "month": self.month,
            "opening_balance": quantize_brl(self.opening),
            "days": days,
            # Balance on the last real day (today for this month): equals "Saldo total".
            "balance": quantize_brl(balance),
        }
