from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

def money_to_cents(value) -> int:
    if value is None or value == "":
        return 0
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"Invalid monetary value: {value!r}") from exc
    return int(amount * 100)

def cents_to_decimal(cents: int) -> Decimal:
    return (Decimal(cents) / Decimal(100)).quantize(Decimal("0.01"))
