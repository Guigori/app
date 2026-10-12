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
    n = int(tx.get("total_installments") or 1)
    total = cents(tx["value"])
    base = int((D(total) / n).quantize(D(1), rounding=ROUND_HALF_UP))
    # Preserve the existing rounded parcel; reconcile the residual on the last.
    return D(total - base * (n - 1) if offset == n - 1 else base) / 100
