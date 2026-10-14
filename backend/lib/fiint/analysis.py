"""FIINT financial analysis facade.

This compatibility layer preserves FAC v1.3 semantics while consumers
migrate to the canonical FIINT namespace. No database access is performed
here; callers supply already authorized, normalized user data.
"""
from datetime import date
from typing import Any, Iterable

from lib.fac.analysis import category_change_analyses as _legacy_category_change


def category_change_analyses(
    transactions: Iterable[dict[str, Any]],
    categories: Iterable[dict[str, Any]],
    *,
    as_of: date,
    limit: int | None = 7,
) -> list[dict[str, Any]]:
    """Analyze category spending with the preserved v1.3 rules.

    This does not train a model or persist user data.
    """
    return _legacy_category_change(
        list(transactions), list(categories), as_of=as_of, limit=limit
    )
