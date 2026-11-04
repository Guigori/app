"""Pure monthly recurrence projection shared by Flow and Budget V2.

Existing rows remain the source of truth. A repeated fixed row updates its series
instead of creating a second perpetual forecast. Nothing is written to Firestore.
"""
import calendar
from datetime import date


def series_key(tx: dict) -> tuple:
    """Identify a recurring series, preferring a durable series identifier.

    Legacy records have no series ID, so a conservative composite identity is
    used. Explicit entries with the same identity replace a projected occurrence.
    """
    series_id = tx.get("recurrence_id") or tx.get("series_id")
    if series_id:
        return ("id", str(series_id))
    return (
        "legacy",
        tx.get("type"),
        tx.get("account_id"),
        tx.get("card_id"),
        tx.get("category_id"),
        str(tx.get("name") or "").strip().casefold(),
    )


def monthly_projection_sources(txs: list[dict], month: str) -> list[tuple[dict, str]]:
    """Return at most one future occurrence per series for YYYY-MM.

    Actual entries (paid, pending or scheduled) in the target month always win.
    The newest earlier fixed row supplies the amount and intended day.
    """
    year, month_number = map(int, month.split("-"))
    latest: dict[tuple, dict] = {}
    present: set[tuple] = set()
    for tx in txs:
        if tx.get("invoice_payment") or tx.get("type") == "transferencia":
            continue
        key = series_key(tx)
        tx_month = str(tx.get("date") or "")[:7]
        if tx_month == month:
            present.add(key)
        if not tx.get("fixed") or tx.get("installment") or (tx.get("recurrence") or "mensal") != "mensal":
            continue
        if tx_month >= month:
            continue
        previous = latest.get(key)
        if previous is None or str(tx["date"]) > str(previous["date"]):
            latest[key] = tx
    last = calendar.monthrange(year, month_number)[1]
    return [
        (tx, date(year, month_number, min(int(str(tx["date"])[8:10]), last)).isoformat())
        for key, tx in latest.items()
        if key not in present
    ]


def projections_in_period(txs: list[dict], start: date, end: date) -> list[tuple[dict, date]]:
    """Projected occurrences inside an arbitrary inclusive budget cycle."""
    if end < start:
        return []
    start_index = start.year * 12 + start.month - 1
    end_index = end.year * 12 + end.month - 1
    out = []
    for index in range(start_index, end_index + 1):
        month = f"{index // 12:04d}-{index % 12 + 1:02d}"
        for tx, day in monthly_projection_sources(txs, month):
            projected = date.fromisoformat(day)
            if start <= projected <= end:
                out.append((tx, projected))
    return out
