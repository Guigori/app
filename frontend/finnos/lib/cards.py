from finnos.lib.money import D

"""Credit-card cycle math: open invoice window, due date and best purchase day.

Mirror in the browser: frontend/src/lib/local/engine.ts (localListCards).
"""
import calendar
from datetime import date, timedelta


def _clamp_day(year: int, month: int, day: int) -> date:
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last))


def _shift(d: date, months: int) -> date:
    idx = d.year * 12 + (d.month - 1) + months
    return _clamp_day(idx // 12, idx % 12 + 1, d.day)


def cycle_bounds(today: date, closing_day: int) -> tuple[date, date]:
    """Open invoice window: the day after the last closing through the next closing."""
    this_closing = _clamp_day(today.year, today.month, closing_day)
    if today <= this_closing:
        next_closing = this_closing
        previous_index = today.year * 12 + (today.month - 1) - 1
        prev_closing = _clamp_day(previous_index // 12, previous_index % 12 + 1, closing_day)
    else:
        next_index = today.year * 12 + (today.month - 1) + 1
        next_closing = _clamp_day(next_index // 12, next_index % 12 + 1, closing_day)
        prev_closing = this_closing
    return (prev_closing + timedelta(days=1), next_closing)


def due_date(next_closing: date, closing_day: int, due_day: int) -> date:
    """The payment date of the invoice that closes on `next_closing`."""
    if due_day > closing_day:
        return _clamp_day(next_closing.year, next_closing.month, due_day)
    return _shift(_clamp_day(next_closing.year, next_closing.month, due_day), 1)


def best_purchase_day(next_closing: date) -> date:
    """Buying right after the closing gives the longest float."""
    return next_closing + timedelta(days=1)
