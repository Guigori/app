"""Provider-neutral deterministic parsing of OCR/PDF text into candidate transactions."""
import re

from finnos.document_intelligence.models import (
    ConfidenceLevel,
    Direction,
    Evidence,
    ExtractedField,
    ExtractedTransaction,
    TextSpan,
)
from finnos.document_intelligence.normalization import parse_brl_cents, parse_ptbr_date


# Deliberately requires a date at the start and one final monetary token.
# It does not guess which of multiple amount columns is the transaction amount.
_ROW_RE = re.compile(
    r"^\s*(?P<date>\d{2}/\d{2}/\d{2,4})\s+"
    r"(?P<description>.+?)\s+"
    r"(?P<amount>-?\s*(?:R\$\s*)?\d[\d.]*,\d{1,2}|-?\s*(?:R\$\s*)?\d+\.\d{1,2})"
    r"\s*(?P<marker>[DC])?\s*$",
    re.IGNORECASE,
)


def confidence_level(score: float) -> ConfidenceLevel:
    if score >= 0.95:
        return ConfidenceLevel.HIGH
    if score >= 0.80:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.LOW


def parse_statement_span(span: TextSpan, *, source_engine: str) -> ExtractedTransaction | None:
    line = " ".join(span.text.split())
    match = _ROW_RE.match(line)
    if not match:
        return None

    raw_date = match.group("date")
    raw_description = match.group("description").strip(" -|")
    raw_amount = match.group("amount").strip()
    marker = (match.group("marker") or "").upper()

    if not raw_description:
        return None

    evidence = Evidence(page=span.page, text=span.text, bounding_box=span.bounding_box)
    try:
        normalized_date = parse_ptbr_date(raw_date)
        date_field = ExtractedField(
            normalized_date, raw_date, 0.99, source_engine, evidence, "valid"
        )
    except ValueError:
        date_field = ExtractedField(
            None, raw_date, 0.20, source_engine, evidence, "invalid"
        )

    try:
        cents = parse_brl_cents(raw_amount)
        amount_field = ExtractedField(
            abs(cents), raw_amount, 0.98, source_engine, evidence, "valid"
        )
    except ValueError:
        cents = 0
        amount_field = ExtractedField(
            None, raw_amount, 0.10, source_engine, evidence, "invalid"
        )

    description_field = ExtractedField(
        raw_description, raw_description, 0.85, source_engine, evidence, "not_validated"
    )

    # D/C markers are explicit statement semantics. Without one, a negative
    # sign is evidence of an outgoing movement; positive unsigned values stay unknown.
    if marker == "D" or raw_amount.startswith("-"):
        direction = Direction.EXPENSE
    elif marker == "C":
        direction = Direction.INCOME
    else:
        direction = Direction.UNKNOWN

    scores = [date_field.confidence, description_field.confidence, amount_field.confidence]
    score = round(sum(scores) / len(scores), 4)
    warnings = []
    if direction == Direction.UNKNOWN:
        warnings.append("direction_not_explicit")
    if date_field.value is None:
        warnings.append("invalid_date")
    if amount_field.value is None:
        warnings.append("invalid_amount")

    return ExtractedTransaction(
        transaction_date=date_field,
        description=description_field,
        amount_cents=amount_field,
        direction=direction,
        confidence=score,
        confidence_level=confidence_level(score),
        warnings=warnings,
    )
