from finnos.lib.money import D, installment_portion

"""Month & money math shared by FINNOS routers.

Amounts use Decimal; storage uses cents, with installment residual reconciliation. Transaction dates are plain
"YYYY-MM-DD" strings (sortable, immune to the naive-datetime trap).
"""
import calendar
from datetime import date, datetime, timezone
from finnos.lib.dates import today_iso


def aware(dt: datetime | None) -> datetime | None:
    """BSON hands naive UTC datetimes back — normalise so Pydantic serialises the offset."""
    if isinstance(dt, datetime) and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def today_date() -> date:
    return date.fromisoformat(today_iso())


def month_bounds(month: str) -> tuple[str, str]:
    """'2026-09' -> ('2026-09-01', '2026-09-30')."""
    y, m = (int(month[:4]), int(month[5:7]))
    if not 1 <= m <= 12 or not 1 <= y <= 9999:
        from fastapi import HTTPException

        raise HTTPException(422, "Mês inválido.")
    last = calendar.monthrange(y, m)[1]
    return (f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{last:02d}")


def add_months(month: str, delta: int) -> str:
    y, m = (int(month[:4]), int(month[5:7]))
    idx = y * 12 + (m - 1) + delta
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def months_between(a: str, b: str) -> int:
    """Whole months from month `a` to month `b` (positive when b is after a)."""
    ya, ma, yb, mb = (int(a[:4]), int(a[5:7]), int(b[:4]), int(b[5:7]))
    return yb * 12 + mb - (ya * 12 + ma)


def month_portion(tx: dict, month: str) -> float | None:
    """Positive amount the transaction contributes to `month`'s income/expense stats.

    Installments spread as one installment_value per month, from the purchase
    month to the last installment — so future parcels never double-count in the
    current month. Pending/scheduled money and transfers count as zero.
    """
    if tx.get("invoice_payment") or tx.get("type") == "transferencia" or tx.get("status") != "pago":
        return None
    d: str = tx["date"]
    if tx.get("installment"):
        n = int(tx.get("total_installments") or 1)
        offset = months_between(d[:7], month)
        if 0 <= offset < n:
            return installment_portion(tx, offset)
        return None
    return round(D(tx["value"]), 2) if d[:7] == month else None


def paid_future_is_inconsistent(status: str, tx_date: str, today: str) -> bool:
    """A not-yet-occurred cash transaction cannot be marked as settled.

    Callers reject new inconsistent writes; existing data remains untouched until
    an explicit user-confirmed remediation/migration is designed.
    """
    return status == "pago" and tx_date > today


def balance_effects(tx: dict, today: str) -> list[tuple[str, float]]:
    """Signed effect on each account's balance.

    Only paid transactions dated today or earlier affect the realized balance.
    Pending and scheduled transactions never affect the realized balance.
    A parcelado purchase counts only the installments already come due.
    """
    if tx.get("card_id") or tx.get("status") != "pago" or tx.get("date", "") > today:
        return []
    v = D(tx["value"])
    if tx.get("installment"):
        n = int(tx.get("total_installments") or 1)
        due = months_between(tx["date"][:7], today[:7]) + 1
        v = sum((installment_portion(tx, i) for i in range(max(0, min(due, n)))), D(0))
    if tx["type"] == "receita":
        return [(tx["account_id"], round(v, 2))]
    if tx["type"] == "despesa":
        return [(tx["account_id"], round(-v, 2))]
    effects = [(tx["account_id"], round(-v, 2))]
    if tx.get("to_account_id") and tx["to_account_id"] != tx["account_id"]:
        effects.append((tx["to_account_id"], round(v, 2)))
    return effects
