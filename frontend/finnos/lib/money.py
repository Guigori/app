"""Exact BRL arithmetic; numeric JSON preserves the existing browser contract."""

from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, PlainSerializer


def D(value=0):
    return Decimal(str(value))


Money = Annotated[
    Decimal,
    Field(allow_inf_nan=False, max_digits=16, decimal_places=2),
    PlainSerializer(lambda value: float(value), return_type=float, when_used="json"),
]


class FinanceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_default=True)


def cents(value):
    amount = D(value)
    if not amount.is_finite() or abs(amount) > D("9000000000000"):
        raise ValueError("Valor monetário inválido.")
    return int((amount * 100).quantize(D(1), rounding=ROUND_HALF_UP))


def installment_portion(tx, offset):
    """Exact nonnegative installment in reais, adding remaining cents at the end.

    For R$ 100.00 in 3 installments: 33.33, 33.33, 33.34.
    Historical purchases below one cent per installment may include zero
    portions; new creations are rejected in transaction validation.
    """
    n = int(tx.get("total_installments") or 1)
    total = cents(tx["value"])
    if n < 1 or total < 0 or not 0 <= offset < n:
        raise ValueError("Parcelamento inválido: cada parcela deve valer ao menos R$ 0,01.")
    base, remaining = divmod(total, n)
    return D(base + (1 if offset >= n - remaining else 0)) / 100
