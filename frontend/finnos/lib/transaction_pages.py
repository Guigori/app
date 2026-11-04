"""ARQ-02/03: bounded Firestore date-index scans and exact filter semantics.

Search is case-insensitive substring matching (Firestore has no built-in
substring index). Read no more than a bounded scan per page instead of a full
20,000-document materialization; resume at the last examined document. This
guarantees no omitted matches even if a page has zero results.
"""
import re
from datetime import date

from fastapi import HTTPException

from finnos.lib.stats import month_bounds

MAX_SCAN = 400


def transaction_date_window(month: str | None, start: str | None, end: str | None) -> tuple[str, str]:
    if start is not None or end is not None:
        if not start or not end:
            raise HTTPException(422, "Informe as duas datas do período.")
        try:
            start_date, end_date = date.fromisoformat(start), date.fromisoformat(end)
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "Período inválido.") from exc
        if start_date > end_date or (end_date - start_date).days > 365:
            raise HTTPException(422, "Período deve ter até 366 dias.")
        return start_date.isoformat(), end_date.isoformat()
    if not month:
        raise HTTPException(422, "Informe um mês ou período.")
    return month_bounds(month)


def matches_transaction_filters(
    row: dict, *,
    kind: str | None = None,
    status: str | None = None,
    category_id: str | None = None,
    account_id: str | None = None,
    search: str | None = None,
) -> bool:
    if kind and row.get("type") != kind:
        return False
    if status and row.get("status", "pago") != status:
        return False
    if category_id and row.get("category_id") != category_id:
        return False
    if account_id and row.get("account_id") != account_id and row.get("to_account_id") != account_id:
        return False
    if search and search.casefold() not in str(row.get("name") or "").casefold():
        return False
    return True


def bounded_scan_size(limit: int, filtered: bool) -> int:
    return min(MAX_SCAN, max(200, limit * 4)) if filtered else limit + 1


def decode_page(
    snapshots: list, *,
    limit: int,
    filters: dict,
    scan_size: int,
) -> tuple[list, str | None]:
    """Return matched docs plus cursor to last *examined*, not last matched.

    A filtered request may return an empty page with a non-null cursor.
    Callers must keep asking until cursor is null; never derive totals from
    intermediate pages.
    """
    selected = []
    last = None
    examined = 0
    for snap in snapshots:
        row = snap.to_dict() or {}
        last = snap.id
        examined += 1
        if matches_transaction_filters(row, **filters):
            selected.append(snap)
            if len(selected) >= limit:
                break
    more = examined < len(snapshots) or len(snapshots) == scan_size
    return selected, last if more else None
