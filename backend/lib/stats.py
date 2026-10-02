"""Month & money math shared by FINNOS routers.

All amounts are BRL floats rounded to 2 decimals. Transaction dates are plain
"YYYY-MM-DD" strings (sortable, immune to the naive-datetime trap).
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timezone

from lib.dates import today_iso


def aware(dt: datetime | None) -> datetime | None:
    """BSON hands naive UTC datetimes back — normalise so Pydantic serialises the offset."""
    if isinstance(dt, datetime) and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def today_date() -> date:
    return date.fromisoformat(today_iso())


def month_bounds(month: str) -> tuple[str, str]:
    """'2026-09' -> ('2026-09-01', '2026-09-30')."""
    y, m = int(month[:4]), int(month[5:7])
    last = calendar.monthrange(y, m)[1]
    return f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{last:02d}"


def add_months(month: str, delta: int) -> str:
    y, m = int(month[:4]), int(month[5:7])
    idx = y * 12 + (m - 1) + delta
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def months_between(a: str, b: str) -> int:
    """Whole months from month `a` to month `b` (positive when b is after a)."""
    ya, ma, yb, mb = int(a[:4]), int(a[5:7]), int(b[:4]), int(b[5:7])
    return (yb * 12 + mb) - (ya * 12 + ma)


def month_portion(tx: dict, month: str) -> float | None:
    """Positive amount the transaction contributes to `month`'s income/expense stats.

    Installments spread as one installment_value per month, from the purchase
    month to the last installment — so future parcels never double-count in the
    current month. Pending/scheduled money and transfers count as zero.
    """
    if tx.get("type") == "transferencia" or tx.get("status") != "pago":
        return None
    d: str = tx["date"]
    if tx.get("installment"):
        n = int(tx.get("total_installments") or 1)
        offset = months_between(d[:7], month)
        if 0 <= offset < n:
            return round(float(tx.get("installment_value") or 0.0), 2)
        return None
    return round(float(tx["value"]), 2) if d[:7] == month else None


def balance_effects(tx: dict, today: str) -> list[tuple[str, float]]:
    """Signed effect on each account's balance.

    Status is the single source of truth: "pago" means the money moved, so it
    counts regardless of the date; "pendente"/"agendado" never move a balance.
    A parcelado purchase counts only the installments already come due.
    """
    if tx.get("status") != "pago":
        return []
    v = float(tx["value"])
    if tx.get("installment"):
        n = int(tx.get("total_installments") or 1)
        due = months_between(tx["date"][:7], today[:7]) + 1
        v = round(float(tx.get("installment_value") or 0.0) * max(0, min(due, n)), 2)
    if tx["type"] == "receita":
        return [(tx["account_id"], round(v, 2))]
    if tx["type"] == "despesa":
        return [(tx["account_id"], round(-v, 2))]
    effects = [(tx["account_id"], round(-v, 2))]
    if tx.get("to_account_id") and tx["to_account_id"] != tx["account_id"]:
        effects.append((tx["to_account_id"], round(v, 2)))
    return effects
