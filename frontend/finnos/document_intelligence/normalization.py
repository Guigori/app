"""Locale-aware normalization helpers. Monetary values are represented as integer cents.

Everything here fails closed: an ambiguous value raises ``ValueError`` instead
of being guessed, because a wrong amount is worse than a missing one.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

_CURRENCY_RE = re.compile(r"(?i)R\s?\$")
_MINUS_CHARS = {"−": "-", "–": "-", "—": "-"}

MONTHS_PT = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
}

# A monetary token as it appears in a line: optional sign/currency around a
# number that has a decimal part. Integers without cents are not amounts in
# statement rows (they are document numbers, installments, dates...).
AMOUNT_TOKEN_RE = re.compile(
    r"""(?<![\w/.,])
    (?P<token>
      [-+]?(?:\(\s?)?(?:R\s?\$\s?)?[-+]?
      (?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}
      (?:\s?\))?(?:-(?!\d))?
    )
    (?![\w,]|\.\d)""",
    re.VERBOSE | re.IGNORECASE,
)


@dataclass(frozen=True)
class ParsedAmount:
    cents: int  # absolute value
    sign: int | None  # -1 explicit negative, +1 explicit positive, None unsigned
    raw: str

    @property
    def signed(self) -> int:
        return -self.cents if self.sign == -1 else self.cents


def _clean(raw: str) -> str:
    value = raw.strip()
    for bad, good in _MINUS_CHARS.items():
        value = value.replace(bad, good)
    return value


def parse_amount(raw: str) -> ParsedAmount:
    """Parse a BRL amount keeping where its sign came from.

    Accepted: 'R$ 1.234,56', '-15,90', '15,90-', '(15,90)', 'R$ -15,90',
    '-R$ 15,90', '+15,90', '1234.56' (machine format, exactly 2 decimals).
    Rejected: '1234.567', '1,234,56', '12.34.56', '1.234,567', empty/garbage.
    """
    if not isinstance(raw, str):
        raise ValueError("monetary value must be text")
    value = _clean(raw)
    sign: int | None = None

    if value.startswith("(") and value.endswith(")"):
        sign = -1
        value = value[1:-1].strip()
    value = _CURRENCY_RE.sub("", value).replace(" ", "")
    if value.endswith("-") and not value.startswith("-"):
        sign, value = -1, value[:-1]
    if value and value[0] in "+-":
        leading = -1 if value[0] == "-" else 1
        if sign is not None:
            # '-10,00-', '+10,00-', '(-10,00)': two sign sources on one number.
            raise ValueError("conflicting or doubled sign")
        sign = leading
        value = value[1:]
    if value and value[0] in "+-":
        # '-R$-450,00': the same sign repeated around the currency is still one sign.
        if (value[0] == "-") != (sign == -1):
            raise ValueError("conflicting signs")
        value = value[1:]

    if not value or not re.fullmatch(r"[\d.,]+", value):
        raise ValueError("empty or invalid monetary value")

    if "," in value:
        if value.count(",") != 1:
            raise ValueError("invalid decimal separators")
        integer, decimal = value.split(",")
        if "." in integer and not re.fullmatch(r"\d{1,3}(?:\.\d{3})+", integer):
            raise ValueError("invalid Brazilian thousands grouping")
        if not re.fullmatch(r"\d+", integer.replace(".", "")) or not re.fullmatch(r"\d{2}", decimal):
            raise ValueError("cents must have exactly two digits")
        normalized = integer.replace(".", "") + "." + decimal
    elif value.count(".") == 1:
        integer, decimal = value.split(".")
        if re.fullmatch(r"\d+", integer) and re.fullmatch(r"\d{2}", decimal):
            normalized = f"{integer}.{decimal}"  # machine format 1234.56
        elif re.fullmatch(r"\d{1,3}", integer) and re.fullmatch(r"\d{3}", decimal):
            normalized = integer + decimal  # 1.234 = mil duzentos e trinta e quatro
        else:
            raise ValueError("ambiguous monetary value")
    elif "." in value:
        if not re.fullmatch(r"\d{1,3}(?:\.\d{3})+", value):
            raise ValueError("invalid thousands grouping")
        normalized = value.replace(".", "")
    else:
        if not re.fullmatch(r"\d+", value):
            raise ValueError("invalid monetary value")
        normalized = value

    try:
        amount = Decimal(normalized).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:  # pragma: no cover - guarded by regexes above
        raise ValueError("invalid monetary value") from exc
    return ParsedAmount(cents=int(amount * 100), sign=sign, raw=raw)


def parse_brl_cents(raw: str) -> int:
    """Signed integer cents (kept for the foundation API)."""
    return parse_amount(raw).signed


def find_amount_tokens(text: str) -> list[re.Match[str]]:
    return list(AMOUNT_TOKEN_RE.finditer(text))


def fold(text: str) -> str:
    """casefold + strip accents, for keyword matching only (never for evidence)."""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def parse_ptbr_date(raw: str, *, reference_year: int | None = None) -> str:
    """Normalize DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY or '12 NOV 2026' to ISO.

    Dates without a year need ``reference_year``; use :func:`infer_year` when
    the year depends on the document cycle.
    """
    value = _clean(raw)
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    day_month = parse_day_month(value)
    year_match = re.search(r"(\d{4})\s*$", value)
    if day_month and year_match:
        return date(int(year_match.group(1)), day_month[1], day_month[0]).isoformat()
    if day_month and reference_year is not None:
        return date(reference_year, day_month[1], day_month[0]).isoformat()
    raise ValueError("date must include a valid day, month and year")


def parse_day_month(raw: str) -> tuple[int, int] | None:
    """'12/11' or '12 NOV' or '12/nov' -> (12, 11); None if not a day/month."""
    value = fold(_clean(raw))
    match = re.match(r"^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\b|$)", value)
    if match:
        day, month = int(match.group(1)), int(match.group(2))
    else:
        match = re.match(r"^(\d{1,2})\s*(?:de\s+|/|-|\s)\s*([a-z]{3})[a-z]*\.?(?:\b|$)", value)
        if not match or match.group(2) not in MONTHS_PT:
            return None
        day, month = int(match.group(1)), MONTHS_PT[match.group(2)]
    try:
        date(2000, month, day)  # leap year: accepts 29/02
    except ValueError:
        return None
    return day, month


def infer_year(day: int, month: int, anchor: date) -> date:
    """Latest real date with this day/month that is not after ``anchor``.

    Card invoices list 'DD/MM' only. Anchored on the due/closing date, a
    purchase dated after the anchor month belongs to the previous year
    (e.g. '28/12' on an invoice due 10/01/2027 is 28/12/2026).
    """
    for year in (anchor.year, anchor.year - 1, anchor.year - 2):
        try:
            candidate = date(year, month, day)
        except ValueError:  # 29/02 outside a leap year
            continue
        if candidate <= anchor:
            return candidate
    raise ValueError("cannot place day/month before anchor")
