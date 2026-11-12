"""Locale-aware normalization helpers. Monetary values are represented as integer cents."""
import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


_CURRENCY_RE = re.compile(r"(?i)R\$\s*")
_SPACE_RE = re.compile(r"\s+")


def parse_brl_cents(raw: str) -> int:
    """Parse Brazilian currency notation into integer cents.

    Accepted examples: 'R$ 1.234,56', '-15,90', '1.234,56', '1234.56'.
    A single dot followed by exactly three digits is treated as a thousands
    separator; a single dot followed by two digits is treated as decimal.
    Ambiguous or malformed values fail closed.
    """
    if not isinstance(raw, str):
        raise ValueError("monetary value must be text")
    value = _CURRENCY_RE.sub("", raw.strip())
    value = value.replace("−", "-").replace(" ", "")
    value = re.sub(r"[^0-9,.-]", "", value)
    if not value or value in {"-", ".", ","}:
        raise ValueError("empty or invalid monetary value")

    if "," in value:
        if value.count(",") != 1:
            raise ValueError("invalid decimal separators")
        if "." in value:
            integer, decimal = value.rsplit(",", 1)
            if not re.fullmatch(r"-?\d{1,3}(?:\.\d{3})*", integer):
                raise ValueError("invalid Brazilian thousands grouping")
        else:
            integer, decimal = value.rsplit(",", 1)
        if not decimal.isdigit() or len(decimal) not in (1, 2):
            raise ValueError("invalid cents")
        normalized = integer.replace(".", "") + "." + decimal.ljust(2, "0")
    elif value.count(".") == 1:
        integer, decimal = value.split(".")
        if len(decimal) == 3 and integer.lstrip("-").isdigit():
            normalized = integer + decimal
        elif len(decimal) in (1, 2) and integer.lstrip("-").isdigit() and decimal.isdigit():
            normalized = integer + "." + decimal.ljust(2, "0")
        else:
            raise ValueError("ambiguous monetary value")
    elif "." in value:
        if not re.fullmatch(r"-?\d{1,3}(?:\.\d{3})+", value):
            raise ValueError("invalid thousands grouping")
        normalized = value.replace(".", "")
    else:
        if not re.fullmatch(r"-?\d+", value):
            raise ValueError("invalid monetary value")
        normalized = value

    try:
        amount = Decimal(normalized).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise ValueError("invalid monetary value") from exc
    return int(amount * 100)


def parse_ptbr_date(raw: str, *, reference_year: int | None = None) -> str:
    """Normalize DD/MM/YYYY or DD/MM/YY to ISO date; reject missing-year dates."""
    value = raw.strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            parsed = date.strptime(value, fmt) if hasattr(date, "strptime") else None
            if parsed is None:
                from datetime import datetime
                parsed = datetime.strptime(value, fmt).date()
            return parsed.isoformat()
        except ValueError:
            continue
    if reference_year is not None and re.fullmatch(r"\d{2}/\d{2}", value):
        from datetime import datetime
        try:
            return datetime.strptime(f"{value}/{reference_year}", "%d/%m/%Y").date().isoformat()
        except ValueError:
            pass
    raise ValueError("date must include a valid day, month and year")
