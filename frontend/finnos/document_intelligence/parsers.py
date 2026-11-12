"""Provider-neutral deterministic parsing of recognised lines.

A line is split into: leading date, description, optional installment, and
the trailing group of amount tokens (with optional D/C markers). Which trailing
amount is the movement and which is the running balance is decided by the
column layout of the document, never by "take the last number".
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date

from finnos.document_intelligence.models import (
    ConfidenceLevel,
    Direction,
    Evidence,
    ExtractedField,
    ExtractedTransaction,
    Installment,
    OperationKind,
    TextSpan,
    ValidationStatus,
    Word,
)
from finnos.document_intelligence.normalization import (
    MONTHS_PT,
    ParsedAmount,
    find_amount_tokens,
    fold,
    infer_year,
    parse_amount,
    parse_day_month,
    parse_ptbr_date,
)

HIGH = 0.95
MEDIUM = 0.80

_MONTH_ALT = "|".join(MONTHS_PT)
_LEADING_DATE_RE = re.compile(
    rf"^\s*(?P<date>\d{{2}}/\d{{2}}/\d{{4}}|\d{{2}}/\d{{2}}/\d{{2}}(?!\d)|\d{{2}}/\d{{2}}(?![/\d])"
    rf"|\d{{1,2}}\s+(?:{_MONTH_ALT})[a-z]*\.?(?:\s+\d{{4}})?)(?=\s)",
    re.IGNORECASE,
)
_MARKER_RE = re.compile(r"^\s*(?P<marker>[DC])(?![\w])", re.IGNORECASE)
_INSTALLMENT_RES = (
    re.compile(r"(?i)\bparc(?:ela)?\.?\s*(?P<c>\d{1,2})\s*(?:/|de)\s*(?P<t>\d{1,2})\b"),
    re.compile(r"(?i)\b(?P<c>\d{1,2})\s+de\s+(?P<t>\d{1,2})\b"),
    re.compile(r"(?<![\d/])(?P<c>\d{1,2})\s*/\s*(?P<t>\d{1,2})(?![\d/])"),
)


def confidence_level(score: float) -> ConfidenceLevel:
    if score >= HIGH:
        return ConfidenceLevel.HIGH
    if score >= MEDIUM:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.LOW


@dataclass
class AmountToken:
    parsed: ParsedAmount | None
    raw: str
    start: int
    end: int
    marker: str = ""  # 'D' / 'C' right after the amount
    x_center: float | None = None  # normalised page x, when word boxes exist
    error: str = ""


@dataclass
class LineParts:
    span: TextSpan
    date_raw: str
    has_year: bool
    description: str
    amounts: list[AmountToken]
    installment: Installment | None = None
    installment_raw: str = ""
    warnings: list[str] = field(default_factory=list)
    date_repaired: bool = False


def _locate_words(span: TextSpan, tokens: list[AmountToken]) -> None:
    """Attach the x centre of the word(s) that produced each amount token."""
    if not span.words:
        return
    words: Sequence[Word] = span.words
    used: set[int] = set()
    for token in tokens:
        digits = re.sub(r"[^\d,]", "", token.raw)
        for index, word in enumerate(words):
            if index in used:
                continue
            if digits and digits in re.sub(r"[^\d,]", "", word.text):
                used.add(index)
                token.x_center = (word.x0 + word.x1) / 2
                break


# Separators and specks OCR leaves between columns: '|', ':', quotes, a lone letter.
_OCR_NOISE_RE = re.compile(r"[\s|:;.,'\"`~_“”‘’»«=*-]*(?:\b[a-zA-Z]\b)?[\s|:;.,'\"`~_“”‘’»«=*-]*")
_OCR_DATE_RE = re.compile(r"^\s*(?P<d>[0-3]\d)[|lI\\]?(?P<m>[01]?\d)(?P<y>[/|]\d{4})?[:\"'.,]?(?=\s)")


def split_line(span: TextSpan, *, detect_installment: bool = False, repair_dates: bool = False) -> LineParts | None:
    line = " ".join(span.text.split())
    date_match = _LEADING_DATE_RE.match(line)
    repaired = False
    if date_match:
        date_raw = date_match.group("date")
        rest = line[date_match.end():]
    elif repair_dates and (ocr := _OCR_DATE_RE.match(line)):
        # OCR often drops the slash: '1511' or even '151' for '15/11'. The
        # month is resolved later against the document cycle; never above MEDIUM.
        date_raw = f"{ocr.group('d')}/{ocr.group('m')}" + ((ocr.group("y") or "").replace("|", "/"))
        rest = line[ocr.end():]
        repaired = True
    else:
        return None

    matches = find_amount_tokens(rest)
    if not matches:
        return None

    # Keep only the trailing group: amounts separated by blanks/markers up to EOL.
    trailing: list[AmountToken] = []
    cursor = len(rest)
    for match in reversed(matches):
        tail = rest[match.end():cursor]
        marker_match = _MARKER_RE.match(tail)
        marker = marker_match.group("marker").upper() if marker_match else ""
        leftover = tail[marker_match.end():] if marker_match else tail
        if leftover.strip() and not (repair_dates and _OCR_NOISE_RE.fullmatch(leftover)):
            break
        token = AmountToken(parsed=None, raw=match.group("token").strip(), start=match.start(), end=match.end(), marker=marker)
        try:
            token.parsed = parse_amount(token.raw)
        except ValueError as exc:
            token.error = str(exc)
        trailing.insert(0, token)
        cursor = match.start()
    if not trailing:
        return None

    description = rest[: trailing[0].start].strip(" -|\t")
    description = re.sub(r"(?i)\s*R\s?\$\s*$", "", description).strip()
    if repair_dates:
        # OCR specks: pure punctuation tokens anywhere, a lone lowercase letter at the end.
        tokens = [t for t in description.split() if re.search(r"\w", t)]
        while tokens and re.fullmatch(r"[a-z]", tokens[-1]):
            tokens.pop()
        description = " ".join(t.strip(":;|'\"“”") for t in tokens).strip()

    installment: Installment | None = None
    installment_raw = ""
    warnings: list[str] = []
    for pattern in (_INSTALLMENT_RES if detect_installment else ()):
        found = list(pattern.finditer(description))
        if not found:
            continue
        candidate = found[-1]
        current, total = int(candidate.group("c")), int(candidate.group("t"))
        if 1 <= current <= total and total >= 2:
            installment = Installment(current, total)
            installment_raw = candidate.group(0)
            description = (description[: candidate.start()] + description[candidate.end():]).strip(" -")
            description = " ".join(re.sub(r"\(\s*\)|\[\s*\]", "", description).split()).strip(" -")
        elif total >= 2:
            warnings.append("installment_out_of_range")
        break

    if not description:
        return None
    parts = LineParts(
        span=span,
        date_raw=date_raw,
        has_year=bool(re.search(r"\d{4}$|/\d{2}/\d{2}$", date_raw)),
        description=description,
        amounts=trailing,
        installment=installment,
        installment_raw=installment_raw,
        warnings=warnings + (["date_repaired_from_ocr"] if repaired else []),
    )
    parts.date_repaired = repaired
    _locate_words(span, trailing)
    return parts


# ---------------------------------------------------------------- semantics

_INVOICE_RULES: tuple[tuple[OperationKind, tuple[str, ...]], ...] = (
    (OperationKind.PREVIOUS_BALANCE, ("saldo anterior", "fatura anterior", "saldo em aberto", "total da fatura anterior")),
    (OperationKind.INVOICE_PAYMENT, ("pagamento recebido", "pagamento efetuado", "pagamento de fatura", "pagto fatura",
                                     "pagamento fatura", "pagamento obrigado", "pagamento - obrigado", "pagamento em")),
    (OperationKind.REFUND, ("estorno", "cancelamento", "reembolso", "devolucao", "chargeback")),
    (OperationKind.CREDIT, ("credito", "cashback", "bonificacao", "ajuste a favor", "desconto")),
    (OperationKind.IOF, ("iof",)),
    (OperationKind.LATE_INTEREST, ("juros de mora", "juros mora", "mora")),
    (OperationKind.INTEREST, ("juros",)),
    (OperationKind.LATE_FEE, ("multa",)),
    (OperationKind.CHARGES, ("encargo", "rotativo", "financiamento", "parcelamento de fatura")),
    (OperationKind.ANNUAL_FEE, ("anuidade",)),
    (OperationKind.BANK_FEE, ("tarifa", "avaliacao emergencial")),
    (OperationKind.CASH_WITHDRAWAL, ("saque",)),
)

_STATEMENT_RULES: tuple[tuple[OperationKind, tuple[str, ...]], ...] = (
    (OperationKind.CARD_BILL_PAYMENT, ("pagamento fatura", "pagto fatura", "pag fatura", "fatura cartao", "pgto fatura")),
    (OperationKind.REFUND, ("estorno", "devolucao")),
    (OperationKind.SALARY, ("salario", "proventos", "folha de pagamento", "pagto salario")),
    (OperationKind.PIX_IN, ("pix recebido", "pix receb", "recebimento pix", "pix - recebido", "pix credito")),
    (OperationKind.PIX_OUT, ("pix enviado", "pix envio", "pix emitido", "pagamento pix", "pix - enviado", "pix transf", "pix debito")),
    (OperationKind.TRANSFER_IN, ("ted recebida", "doc recebido", "transf recebida", "transferencia recebida", "ted receb")),
    (OperationKind.TRANSFER_OUT, ("ted enviada", "doc enviado", "transf enviada", "transferencia enviada", "ted envi",
                                  "transferencia realizada")),
    (OperationKind.DEPOSIT, ("deposito",)),
    (OperationKind.BANK_FEE, ("tarifa", "cesta de servicos", "mensalidade pacote")),
    (OperationKind.CASH_WITHDRAWAL, ("saque",)),
    (OperationKind.IOF, ("iof",)),
    (OperationKind.INTEREST, ("juros",)),
    (OperationKind.BILL_PAYMENT, ("pagamento", "pagto", "boleto", "pag boleto", "conta de")),
    (OperationKind.PURCHASE, ("compra", "debito visa", "debito master", "elo debito", "cartao debito")),
)

_INCOME_OPERATIONS = {
    OperationKind.INVOICE_PAYMENT, OperationKind.REFUND, OperationKind.CREDIT,
    OperationKind.PIX_IN, OperationKind.TRANSFER_IN, OperationKind.DEPOSIT, OperationKind.SALARY,
}


def classify_operation(description: str, *, invoice: bool, installment: Installment | None) -> tuple[OperationKind, float]:
    folded = fold(description)
    rules = _INVOICE_RULES if invoice else _STATEMENT_RULES
    for kind, terms in rules:
        if any(term in folded for term in terms):
            # A purchase called "CREDITO ..." is rare; keep 'credito' medium.
            if kind == OperationKind.CREDIT and not folded.startswith(("credito", "ajuste", "cashback", "bonificacao", "desconto")):
                return kind, 0.85
            return kind, 0.97
    if invoice:
        return (OperationKind.INSTALLMENT if installment else OperationKind.PURCHASE), 0.96
    return OperationKind.UNKNOWN, 0.85


def is_income_operation(kind: OperationKind) -> bool:
    return kind in _INCOME_OPERATIONS


# ---------------------------------------------------------------- fields


def make_date_field(parts: LineParts, *, source_engine: str, anchor: date | None) -> tuple[ExtractedField, list[str]]:
    evidence = Evidence(parts.span.page, parts.span.text, parts.span.bounding_box)
    ocr = min(parts.span.confidence, 0.85) if parts.date_repaired else parts.span.confidence
    try:
        if parts.has_year:
            value = parse_ptbr_date(parts.date_raw)
            return ExtractedField(value, parts.date_raw, round(min(0.99, ocr), 4), source_engine, evidence,
                                  ValidationStatus.VALID.value), []
        if parts.date_repaired:
            return _repaired_date(parts, source_engine=source_engine, anchor=anchor, evidence=evidence, ocr=ocr)
        day_month = parse_day_month(parts.date_raw)
        if day_month is None:
            raise ValueError("invalid day/month")
        if anchor is None:
            return ExtractedField(None, parts.date_raw, 0.3, source_engine, evidence,
                                  ValidationStatus.AMBIGUOUS.value), ["date_year_unknown"]
        value = infer_year(day_month[0], day_month[1], anchor).isoformat()
        return ExtractedField(value, parts.date_raw, round(min(0.97, ocr), 4), source_engine, evidence,
                              ValidationStatus.VALID.value), []
    except ValueError:
        return ExtractedField(None, parts.date_raw, 0.2, source_engine, evidence,
                              ValidationStatus.INVALID.value), ["invalid_date"]


def _repaired_date(parts: LineParts, *, source_engine: str, anchor: date | None, evidence: Evidence,
                   ocr: float) -> tuple[ExtractedField, list[str]]:
    """Resolve 'DD' + partial month ('1' -> 1 or 11) inside the document cycle."""
    day_text, month_text = parts.date_raw.split("/")[:2]
    day = int(day_text)
    candidates = {int(month_text)} | ({10 + int(month_text)} if len(month_text) == 1 and int(month_text) <= 2 else set())
    if anchor is None:
        return ExtractedField(None, parts.date_raw, 0.3, source_engine, evidence,
                              ValidationStatus.AMBIGUOUS.value), ["date_year_unknown"]
    placed = []
    for month in sorted(candidates):
        if not 1 <= month <= 12:
            continue
        try:
            candidate = infer_year(day, month, anchor)
        except ValueError:
            continue
        if (anchor - candidate).days <= 75:
            placed.append(candidate)
    if len(placed) != 1:
        return ExtractedField(None, parts.date_raw, 0.3, source_engine, evidence,
                              ValidationStatus.AMBIGUOUS.value), ["date_ambiguous_after_ocr"]
    return ExtractedField(placed[0].isoformat(), parts.date_raw, round(min(0.85, ocr), 4), source_engine, evidence,
                          ValidationStatus.VALID.value), []


def make_amount_field(token: AmountToken, parts: LineParts, *, source_engine: str, certainty: float) -> ExtractedField:
    evidence = Evidence(parts.span.page, parts.span.text, parts.span.bounding_box)
    if token.parsed is None:
        return ExtractedField(None, token.raw, 0.1, source_engine, evidence, ValidationStatus.INVALID.value)
    return ExtractedField(token.parsed.cents, token.raw, round(min(certainty, parts.span.confidence), 4),
                          source_engine, evidence, ValidationStatus.VALID.value)


def explicit_direction(token: AmountToken) -> tuple[Direction | None, str | None]:
    """Direction stated by the document itself (sign or D/C marker)."""
    sign = token.parsed.sign if token.parsed else None
    marker = token.marker
    from_sign = Direction.EXPENSE if sign == -1 else Direction.INCOME if sign == 1 else None
    from_marker = Direction.EXPENSE if marker == "D" else Direction.INCOME if marker == "C" else None
    if from_sign and from_marker and from_sign != from_marker:
        return None, "sign_marker_conflict"
    return from_marker or from_sign, None


def finalize(row: ExtractedTransaction, component_scores: Sequence[float]) -> ExtractedTransaction:
    """Final confidence = the weakest component. An average would hide a bad field."""
    score = round(min(component_scores), 4) if component_scores else 0.0
    if any(check.passed is False for check in row.checks):
        score = min(score, 0.6)
    row.confidence = score
    row.confidence_level = confidence_level(score)
    return row


# ---------------------------------------------------------------- foundation API


def parse_statement_span(span: TextSpan, *, source_engine: str) -> ExtractedTransaction | None:
    """Parse one statement line on its own (no layout context).

    With more than one trailing amount the movement cannot be told apart from
    the balance without the column layout, so the amount is left empty and
    the row is flagged for review instead of guessing.
    """
    parts = split_line(span)
    if parts is None:
        return None
    date_field, warnings = make_date_field(parts, source_engine=source_engine, anchor=None)
    warnings = parts.warnings + warnings
    evidence = Evidence(span.page, span.text, span.bounding_box)
    description = ExtractedField(parts.description, parts.description, round(min(0.97, span.confidence), 4),
                                 source_engine, evidence)
    if len(parts.amounts) > 1:
        amount_field = ExtractedField(None, " ".join(t.raw for t in parts.amounts), 0.3, source_engine, evidence,
                                      ValidationStatus.AMBIGUOUS.value)
        warnings.append("multiple_amount_columns")
        direction, dir_score = Direction.UNKNOWN, 0.5
    else:
        token = parts.amounts[0]
        amount_field = make_amount_field(token, parts, source_engine=source_engine, certainty=0.99)
        if amount_field.value is None:
            warnings.append("invalid_amount")
        direction, problem = explicit_direction(token)
        if problem:
            warnings.append(problem)
        if direction is None:
            direction = Direction.UNKNOWN
            if not problem:
                warnings.append("direction_not_explicit")
        dir_score = 0.99 if direction != Direction.UNKNOWN else (0.5 if problem else 0.85)

    operation, semantic = classify_operation(parts.description, invoice=False, installment=parts.installment)
    row = ExtractedTransaction(
        transaction_date=date_field,
        description=description,
        amount_cents=amount_field,
        direction=direction,
        operation=operation,
        installment=parts.installment,
        warnings=warnings,
    )
    return finalize(row, [date_field.confidence, amount_field.confidence, description.confidence, dir_score, semantic])
