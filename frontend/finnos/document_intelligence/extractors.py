"""Bank statement and credit card invoice extractors.

Both work on provider-neutral ``TextSpan`` lines (native PDF text or OCR) and
return candidates for human review. Nothing here writes anywhere.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date

from finnos.document_intelligence.models import (
    Check,
    Direction,
    Evidence,
    ExtractedField,
    ExtractedTransaction,
    OperationKind,
    TextSpan,
    ValidationStatus,
)
from finnos.document_intelligence.normalization import find_amount_tokens, fold, parse_amount, parse_ptbr_date
from finnos.document_intelligence.parsers import (
    AmountToken,
    LineParts,
    classify_operation,
    confidence_level,
    explicit_direction,
    finalize,
    is_income_operation,
    make_amount_field,
    make_date_field,
    split_line,
)

_FULL_DATE_RE = re.compile(
    r"(\d{2}/\d{2}/\d{4}|\d{2}/\d{2}/\d{2}(?!\d)|\d{1,2}\s+(?:de\s+)?(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s+(?:de\s+)?\d{4})",
    re.IGNORECASE,
)


# ---------------------------------------------------------------- labelled fields


def _is_ocr(source_engine: str) -> bool:
    return any(name in source_engine for name in ("tesseract", "paddleocr", "ocr"))


def _evidence(span: TextSpan) -> Evidence:
    return Evidence(span.page, span.text, span.bounding_box)


def find_labeled_amount(
    spans: Sequence[TextSpan], labels: Sequence[str], *, source_engine: str, exclude: Sequence[str] = ()
) -> ExtractedField | None:
    """First amount printed after one of ``labels`` (same line, or the next line)."""
    for index, span in enumerate(spans):
        folded = fold(span.text)
        for label in labels:
            position = folded.find(label)
            if position < 0 or any(term in folded for term in exclude):
                continue
            # fold() keeps length for Latin text, so positions map back.
            tail = span.text[position + len(label):]
            tokens = find_amount_tokens(tail)
            target, source_span = (tokens[0] if tokens else None), span
            if target is None and index + 1 < len(spans):
                following = spans[index + 1]
                next_tokens = find_amount_tokens(following.text)
                if len(next_tokens) == 1 and not re.match(r"^\s*\d{2}/\d{2}", following.text):
                    target, source_span = next_tokens[0], following
            if target is None:
                continue
            raw = target.group("token").strip()
            try:
                parsed = parse_amount(raw)
            except ValueError:
                return ExtractedField(None, raw, 0.1, source_engine, _evidence(source_span), ValidationStatus.INVALID.value)
            return ExtractedField(parsed.signed, raw, round(min(0.98, source_span.confidence), 4), source_engine,
                                  _evidence(source_span), ValidationStatus.VALID.value)
    return None


def find_labeled_date(
    spans: Sequence[TextSpan], labels: Sequence[str], *, source_engine: str
) -> ExtractedField | None:
    for index, span in enumerate(spans):
        folded = fold(span.text)
        for label in labels:
            position = folded.find(label)
            if position < 0:
                continue
            candidates = [(span, span.text[position + len(label):])]
            if index + 1 < len(spans):
                candidates.append((spans[index + 1], spans[index + 1].text))
            for source_span, text in candidates:
                match = _FULL_DATE_RE.search(text)
                if not match:
                    continue
                raw = match.group(1)
                try:
                    value = parse_ptbr_date(re.sub(r"(?i)\bde\s+", "", raw))
                except ValueError:
                    return ExtractedField(None, raw, 0.2, source_engine, _evidence(source_span),
                                          ValidationStatus.INVALID.value)
                return ExtractedField(value, raw, round(min(0.98, source_span.confidence), 4), source_engine,
                                      _evidence(source_span), ValidationStatus.VALID.value)
    return None


def find_period(spans: Sequence[TextSpan], *, source_engine: str) -> tuple[ExtractedField | None, ExtractedField | None]:
    pattern = re.compile(
        r"(?i)(?:periodo|período|de)\s*:?\s*(\d{2}/\d{2}/\d{4})\s*(?:a|ate|até|-|–)\s*(\d{2}/\d{2}/\d{4})"
    )
    for span in spans:
        match = pattern.search(span.text)
        if match:
            start = ExtractedField(parse_ptbr_date(match.group(1)), match.group(1), round(min(0.98, span.confidence), 4),
                                   source_engine, _evidence(span), ValidationStatus.VALID.value)
            end = ExtractedField(parse_ptbr_date(match.group(2)), match.group(2), round(min(0.98, span.confidence), 4),
                                 source_engine, _evidence(span), ValidationStatus.VALID.value)
            return start, end
    return None, None


def _as_date(item: ExtractedField | None) -> date | None:
    if item is None or not item.value:
        return None
    return date.fromisoformat(item.value)


# ---------------------------------------------------------------- column layout


@dataclass
class Layout:
    columns: dict[str, float] = field(default_factory=dict)  # name -> normalised x centre
    has_balance: bool = False
    has_debit_credit: bool = False
    header: TextSpan | None = None


_COLUMN_WORDS = {
    "valor": "amount", "valor(r$)": "amount", "montante": "amount",
    "saldo": "balance", "saldo(r$)": "balance",
    "debito": "debit", "debitos": "debit", "saida": "debit", "saidas": "debit",
    "credito": "credit", "creditos": "credit", "entrada": "credit", "entradas": "credit",
}


def detect_layout(spans: Sequence[TextSpan]) -> Layout:
    for span in spans:
        folded = fold(span.text)
        words = re.findall(r"[a-z()$]+", folded)
        names = {_COLUMN_WORDS[w] for w in words if w in _COLUMN_WORDS}
        has_date = "data" in words
        if not has_date or len(names) < 2 and not ({"balance"} <= names and len(words) >= 3):
            continue
        layout = Layout(header=span, has_balance="balance" in names,
                        has_debit_credit={"debit", "credit"} <= names)
        for word in span.words:
            key = _COLUMN_WORDS.get(fold(word.text).strip(":"))
            if key and key not in layout.columns:
                layout.columns[key] = (word.x0 + word.x1) / 2
        return layout
    return Layout()


def _nearest_column(layout: Layout, x: float | None) -> str | None:
    if x is None or not layout.columns:
        return None
    name, position = min(layout.columns.items(), key=lambda kv: abs(kv[1] - x))
    return name if abs(position - x) <= 0.12 else None


# ---------------------------------------------------------------- shared row helpers


_TRAILING_CURRENCY_RE = re.compile(r"(?i)\s*(?:US\$|USD|EUR|€|U\$|R\$)\s*$")


def _description_field(parts: LineParts, source_engine: str) -> ExtractedField:
    parts.description = _TRAILING_CURRENCY_RE.sub("", parts.description).strip() or parts.description
    return ExtractedField(parts.description, parts.description, round(min(0.97, parts.span.confidence), 4),
                          source_engine, _evidence(parts.span))


def _mark_duplicates(rows: list[ExtractedTransaction]) -> None:
    seen: dict[tuple, int] = {}
    for row in rows:
        key = (
            row.transaction_date.value if row.transaction_date else None,
            row.amount_cents.value if row.amount_cents else None,
            fold(row.description.value) if row.description and row.description.value else None,
            row.installment.to_dict()["current"] if row.installment else None,
        )
        if None in key[:3]:
            continue
        if key in seen:
            # Two equal purchases on the same day are often real: flag, never drop.
            row.warnings.append("possible_duplicate_in_document")
            seen[key] += 1
        else:
            seen[key] = 1


def _cap_unverified(rows: list[ExtractedTransaction], checks: list[Check], document_check: str,
                    *, row_check: str | None = None) -> None:
    """HIGH requires a financial cross-check, not just a clean reading.

    If the document total/balance could not be evaluated, a row stays HIGH
    only when its own running-balance check passed; otherwise it is capped
    just below HIGH so the reviewer sees it highlighted.
    """
    if any(c.name == document_check and c.passed is True for c in checks):
        return
    for row in rows:
        if row_check and any(c.name == row_check and c.passed for c in row.checks):
            continue
        if row.confidence >= 0.95:
            row.confidence = 0.94
            row.confidence_level = confidence_level(row.confidence)
            row.warnings.append("not_cross_checked")


# ---------------------------------------------------------------- bank statement


@dataclass
class StatementExtraction:
    fields: dict[str, ExtractedField]
    rows: list[ExtractedTransaction]
    checks: list[Check]
    warnings: list[str]


def _is_balance_line(description: str) -> bool:
    folded = fold(description)
    return folded.startswith(("saldo", "s a l d o", "sdo ")) or folded in {"saldo do dia", "saldo final"}


def extract_bank_statement(spans: Sequence[TextSpan], *, source_engine: str) -> StatementExtraction:
    fields: dict[str, ExtractedField] = {}
    warnings: list[str] = []
    checks: list[Check] = []
    start, end = find_period(spans, source_engine=source_engine)
    if start:
        fields["period_start"], fields["period_end"] = start, end
    layout = detect_layout(spans)

    full_dates = []
    for span in spans:
        parts = split_line(span)
        if parts and parts.has_year:
            try:
                full_dates.append(date.fromisoformat(parse_ptbr_date(parts.date_raw)))
            except ValueError:
                pass
    anchor = _as_date(end) or (max(full_dates) if full_dates else None)

    opening = find_labeled_amount(spans, ("saldo anterior", "saldo inicial"), source_engine=source_engine)
    closing = find_labeled_amount(spans, ("saldo final", "saldo atual", "saldo em conta"), source_engine=source_engine)

    rows: list[ExtractedTransaction] = []
    balance: int | None = opening.value if opening and opening.value is not None else None
    pending: list[ExtractedTransaction] = []  # rows since the last known balance

    ocr = _is_ocr(source_engine)
    for index, span in enumerate(spans):
        parts = split_line(span, repair_dates=ocr)
        if parts is None or (layout.header is not None and span is layout.header):
            continue
        if _is_balance_line(parts.description):
            token = parts.amounts[-1]
            if token.parsed is None:
                continue
            value = token.parsed.signed if token.marker != "D" else -token.parsed.cents
            folded = fold(parts.description)
            if "anterior" in folded or "inicial" in folded:
                if opening is None:
                    opening = make_amount_field(token, parts, source_engine=source_engine, certainty=0.98)
                    opening = ExtractedField(value, opening.raw_value, opening.confidence, source_engine,
                                             opening.evidence, opening.validation_status)
                balance = value
                pending = []
            else:
                _settle_pending(pending, balance, value, checks)
                balance, pending = value, []
                fields["last_balance_line"] = ExtractedField(
                    value, token.raw, round(min(0.98, span.confidence), 4), source_engine, _evidence(span),
                    ValidationStatus.VALID.value)
            continue

        row = _statement_row(parts, layout, anchor=anchor, source_engine=source_engine, index=index)
        rows.append(row)
        pending.append(row)
        if row.balance_cents is not None and row.balance_cents.value is not None:
            _settle_pending(pending, balance, row.balance_cents.value, checks)
            balance, pending = row.balance_cents.value, []

    if opening is not None:
        fields["opening_balance"] = opening
    if closing is None and "last_balance_line" in fields:
        closing = fields["last_balance_line"]
    fields.pop("last_balance_line", None)
    if closing is not None:
        fields["closing_balance"] = closing

    for row in rows:
        _score_statement_row(row)

    if opening is not None and closing is not None and opening.value is not None and closing.value is not None:
        signed = [r.signed_cents for r in rows]
        if all(value is not None for value in signed):
            expected = opening.value - sum(signed)  # signed: + = money out
            checks.append(Check("statement_balance", expected == closing.value,
                                "saldo inicial + entradas - saídas = saldo final", expected, closing.value))
        else:
            checks.append(Check("statement_balance", None, "há linhas sem direção definida"))
    else:
        checks.append(Check("statement_balance", None, "saldo inicial ou final não encontrado"))

    if not rows:
        warnings.append("no_transaction_rows_found")
    _mark_duplicates(rows)
    _cap_unverified(rows, checks, "statement_balance", row_check="running_balance")
    if any(c.name == "statement_balance" and c.passed is False for c in checks):
        warnings.append("statement_balance_mismatch")
        for row in rows:
            row.confidence = min(row.confidence, 0.9)
            row.confidence_level = confidence_level(row.confidence)
    return StatementExtraction(fields, rows, checks, warnings)


def _statement_row(parts: LineParts, layout: Layout, *, anchor: date | None, source_engine: str, index: int) -> ExtractedTransaction:
    date_field, date_warnings = make_date_field(parts, source_engine=source_engine, anchor=anchor)
    warnings = list(parts.warnings) + date_warnings
    description = _description_field(parts, source_engine)
    amounts = parts.amounts
    amount_token: AmountToken | None = None
    balance_token: AmountToken | None = None
    certainty = 0.99
    column_direction: Direction | None = None

    if len(amounts) == 1:
        amount_token = amounts[0]
        column = _nearest_column(layout, amount_token.x_center)
        if column == "balance":
            warnings.append("amount_in_balance_column")
            certainty = 0.5
        column_direction = Direction.EXPENSE if column == "debit" else Direction.INCOME if column == "credit" else None
    elif len(amounts) == 2 and layout.has_balance:
        amount_token, balance_token = amounts
        columns = (_nearest_column(layout, amount_token.x_center), _nearest_column(layout, balance_token.x_center))
        if columns[1] == "balance" and columns[0] in {"amount", "debit", "credit"}:
            certainty = 0.99
            column_direction = (Direction.EXPENSE if columns[0] == "debit"
                                else Direction.INCOME if columns[0] == "credit" else None)
        elif None in columns:
            certainty = 0.93  # text-only: layout says amount then balance
            warnings.append("columns_inferred_from_header")
        else:
            certainty = 0.5
            warnings.append("columns_do_not_match_header")
    else:
        warnings.append("multiple_amount_columns")

    if amount_token is None:
        amount_field = ExtractedField(None, " ".join(t.raw for t in amounts), 0.3, source_engine,
                                      _evidence(parts.span), ValidationStatus.AMBIGUOUS.value)
    else:
        amount_field = make_amount_field(amount_token, parts, source_engine=source_engine, certainty=certainty)
        if amount_field.value is None:
            warnings.append("invalid_amount")

    balance_field = None
    if balance_token is not None and balance_token.parsed is not None:
        value = balance_token.parsed.signed if balance_token.marker != "D" else -balance_token.parsed.cents
        balance_field = ExtractedField(value, balance_token.raw, round(min(certainty, parts.span.confidence), 4),
                                       source_engine, _evidence(parts.span), ValidationStatus.VALID.value)

    operation, semantic = classify_operation(parts.description, invoice=False, installment=None)
    direction = Direction.UNKNOWN
    direction_source = "none"
    if amount_token is not None:
        stated, problem = explicit_direction(amount_token)
        if problem:
            warnings.append(problem)
        if stated and column_direction and stated != column_direction:
            warnings.append("sign_column_conflict")
        elif stated or column_direction:
            direction = stated or column_direction
            direction_source = "document"
        if problem:
            direction, direction_source = Direction.UNKNOWN, "conflict"

    row = ExtractedTransaction(
        transaction_date=date_field,
        description=description,
        amount_cents=amount_field,
        balance_cents=balance_field,
        direction=direction,
        operation=operation,
        warnings=warnings,
        line_index=index,
    )
    row._direction_source = direction_source  # type: ignore[attr-defined]
    row._semantic = semantic  # type: ignore[attr-defined]
    return row


def _settle_pending(pending: list[ExtractedTransaction], before: int | None, after: int, checks: list[Check]) -> None:
    """Use the printed balance to confirm (or determine) directions.

    balance_before - sum(signed) == balance_after, signed + = money out. If
    exactly one row has an unknown direction, the balance decides it.
    """
    if before is None or not pending:
        return
    rows_with_amount = [r for r in pending if r.amount_cents and r.amount_cents.value is not None]
    if len(rows_with_amount) != len(pending):
        return
    unknown = [r for r in pending if r.direction == Direction.UNKNOWN]
    known_signed = sum(r.signed_cents for r in pending if r.direction != Direction.UNKNOWN)
    delta_out = before - after  # money that left the account
    if len(unknown) == 1:
        rest = delta_out - known_signed
        target = unknown[0]
        if abs(rest) == target.amount_cents.value and rest != 0:
            target.direction = Direction.EXPENSE if rest > 0 else Direction.INCOME
            target._direction_source = "balance"  # type: ignore[attr-defined]
            target.checks.append(Check("running_balance", True, "direção definida pelo saldo impresso", after, after))
        else:
            target.checks.append(Check("running_balance", False, "saldo impresso não fecha com o valor", delta_out, rest))
            target.warnings.append("running_balance_mismatch")
        return
    if unknown:
        return
    ok = known_signed == delta_out
    for row in pending:
        row.checks.append(Check("running_balance", ok, "saldo anterior - saídas + entradas = saldo impresso",
                                before - known_signed, after))
        if ok:
            if getattr(row, "_direction_source", "") == "none":
                row._direction_source = "balance"  # type: ignore[attr-defined]
        else:
            row.warnings.append("running_balance_mismatch")


def _score_statement_row(row: ExtractedTransaction) -> None:
    source = getattr(row, "_direction_source", "none")
    semantic = getattr(row, "_semantic", 0.85)
    if row.direction == Direction.UNKNOWN and source != "conflict" and row.operation != OperationKind.UNKNOWN:
        # Last resort: the description. Never HIGH.
        row.direction = Direction.INCOME if is_income_operation(row.operation) else Direction.EXPENSE
        source = "description"
        row.warnings.append("direction_from_description")
    direction_score = {"document": 0.99, "balance": 0.99, "description": 0.88, "conflict": 0.3}.get(source, 0.5)
    if row.direction == Direction.UNKNOWN and "direction_not_explicit" not in row.warnings:
        row.warnings.append("direction_not_explicit")
    if any(c.name == "running_balance" and c.passed for c in row.checks):
        semantic = max(semantic, 0.95) if row.operation != OperationKind.UNKNOWN else semantic
    scores = [
        row.transaction_date.confidence if row.transaction_date else 0.0,
        row.amount_cents.confidence if row.amount_cents else 0.0,
        row.description.confidence if row.description else 0.0,
        direction_score,
        semantic,
    ]
    finalize(row, scores)
    for attr in ("_direction_source", "_semantic"):
        if hasattr(row, attr):
            delattr(row, attr)


# ---------------------------------------------------------------- credit card invoice


@dataclass
class InvoiceExtraction:
    fields: dict[str, ExtractedField]
    rows: list[ExtractedTransaction]
    checks: list[Check]
    warnings: list[str]


_TOTAL_LABELS = ("valor total da fatura", "total da fatura", "total desta fatura", "total a pagar",
                 "valor da fatura", "total fatura", "valor total")
_FOREIGN_RE = re.compile(r"(?i)(US\$|USD|EUR|€|U\$)\s*$")
EVIDENCE_ONLY_OPERATIONS = {OperationKind.PREVIOUS_BALANCE, OperationKind.INVOICE_PAYMENT}


def extract_card_invoice(spans: Sequence[TextSpan], *, source_engine: str) -> InvoiceExtraction:
    fields: dict[str, ExtractedField] = {}
    warnings: list[str] = []
    checks: list[Check] = []

    due = find_labeled_date(spans, ("data de vencimento", "vencimento"), source_engine=source_engine)
    closing = find_labeled_date(spans, ("data de fechamento", "fechamento", "data do corte", "corte"),
                                source_engine=source_engine)
    total = find_labeled_amount(spans, _TOTAL_LABELS, source_engine=source_engine, exclude=("anterior",))
    minimum = find_labeled_amount(spans, ("pagamento minimo", "valor minimo", "minimo a pagar"), source_engine=source_engine)
    previous = find_labeled_amount(spans, ("total da fatura anterior", "fatura anterior", "saldo anterior"),
                                   source_engine=source_engine)
    limit = find_labeled_amount(spans, ("limite total", "limite de credito"), source_engine=source_engine)
    for name, item in (("due_date", due), ("closing_date", closing), ("total_cents", total),
                       ("minimum_payment_cents", minimum), ("previous_balance_cents", previous),
                       ("credit_limit_cents", limit)):
        if item is not None:
            fields[name] = item
    card = _find_card_last_digits(spans, source_engine)
    if card:
        fields["card_last_digits"] = card
    for name in ("due_date", "total_cents"):
        if name not in fields:
            warnings.append(f"{name}_not_found")

    anchor = _as_date(due) or _as_date(closing)
    rows: list[ExtractedTransaction] = []
    ocr = _is_ocr(source_engine)
    for index, span in enumerate(spans):
        parts = split_line(span, detect_installment=True, repair_dates=ocr)
        if parts is None:
            continue
        rows.append(_invoice_row(parts, anchor=anchor, source_engine=source_engine, index=index))

    if not rows:
        warnings.append("no_transaction_rows_found")
    _mark_duplicates(rows)
    checks.append(_invoice_total_check(rows, total, previous))
    _cap_unverified(rows, checks, "invoice_total")
    if checks[-1].passed is False:
        warnings.append("invoice_total_mismatch")
        for row in rows:
            row.confidence = min(row.confidence, 0.9)
            row.confidence_level = confidence_level(row.confidence)
    return InvoiceExtraction(fields, rows, checks, warnings)


def _find_card_last_digits(spans: Sequence[TextSpan], source_engine: str) -> ExtractedField | None:
    pattern = re.compile(r"(?i)(?:final|terminado em|\*{4}\s?|x{4}\s?|\.{4}\s?)\s*(\d{4})\b")
    for span in spans[:25]:
        if "cart" not in fold(span.text) and "final" not in fold(span.text):
            continue
        match = pattern.search(span.text)
        if match:
            return ExtractedField(match.group(1), match.group(0), round(min(0.97, span.confidence), 4), source_engine,
                                  _evidence(span), ValidationStatus.VALID.value)
    return None


def _invoice_row(parts: LineParts, *, anchor: date | None, source_engine: str, index: int) -> ExtractedTransaction:
    date_field, date_warnings = make_date_field(parts, source_engine=source_engine, anchor=anchor)
    warnings = list(parts.warnings) + date_warnings
    description = _description_field(parts, source_engine)
    span_text = " ".join(parts.span.text.split())

    tokens = parts.amounts
    if len(tokens) > 1:
        # International purchases print the foreign amount before the BRL one.
        brl = [t for t in tokens if not _FOREIGN_RE.search(_text_before(span_text, t))]
        tokens = brl if len(brl) == 1 else tokens
    amount_token = tokens[0] if len(tokens) == 1 else None
    if amount_token is None:
        warnings.append("multiple_amount_columns")
        amount_field = ExtractedField(None, " ".join(t.raw for t in parts.amounts), 0.3, source_engine,
                                      _evidence(parts.span), ValidationStatus.AMBIGUOUS.value)
    else:
        amount_field = make_amount_field(amount_token, parts, source_engine=source_engine, certainty=0.99)
        if amount_field.value is None:
            warnings.append("invalid_amount")

    operation, semantic = classify_operation(parts.description, invoice=True, installment=parts.installment)
    stated, problem = _invoice_direction(amount_token) if amount_token else (None, None)
    if problem:
        warnings.append(problem)
    if problem:
        direction, direction_score = Direction.UNKNOWN, 0.3
    elif stated == Direction.INCOME:
        direction, direction_score = Direction.INCOME, 0.99
        if not is_income_operation(operation) and operation != OperationKind.PREVIOUS_BALANCE:
            # A negative line without a keyword is a credit (usually a refund).
            operation, semantic = OperationKind.CREDIT, 0.85
            warnings.append("credit_without_keyword")
    elif stated == Direction.EXPENSE:
        direction, direction_score = Direction.EXPENSE, 0.99
        if is_income_operation(operation):
            warnings.append("credit_keyword_on_charge")
            semantic = min(semantic, 0.7)
    elif is_income_operation(operation):
        direction, direction_score = Direction.INCOME, 0.9
        warnings.append("direction_from_description")
    else:
        direction, direction_score = Direction.EXPENSE, 0.97  # invoice convention: unsigned = charge

    row = ExtractedTransaction(
        transaction_date=date_field,
        description=description,
        amount_cents=amount_field,
        direction=direction,
        operation=operation,
        installment=parts.installment,
        warnings=warnings,
        line_index=index,
    )
    scores = [date_field.confidence, amount_field.confidence, description.confidence, direction_score, semantic]
    return finalize(row, scores)


def _invoice_direction(token: AmountToken) -> tuple[Direction | None, str | None]:
    """On an invoice a minus sign (or 'C') means a credit to the holder."""
    sign = token.parsed.sign if token.parsed else None
    from_sign = Direction.INCOME if sign == -1 else None
    from_marker = Direction.INCOME if token.marker == "C" else Direction.EXPENSE if token.marker == "D" else None
    if from_sign and from_marker and from_sign != from_marker:
        return None, "sign_marker_conflict"
    return from_marker or from_sign, None


def _text_before(line: str, token: AmountToken) -> str:
    position = line.find(token.raw)
    return line[:position] if position >= 0 else ""


def _invoice_total_check(rows: list[ExtractedTransaction], total: ExtractedField | None,
                         previous: ExtractedField | None) -> Check:
    if total is None or total.value is None:
        return Check("invoice_total", None, "total da fatura não encontrado")
    signed = [r.signed_cents for r in rows]
    if any(value is None for value in signed):
        return Check("invoice_total", None, "há linhas sem valor ou direção definidos", total.value, None)
    everything = sum(signed)
    new_only = sum(r.signed_cents for r in rows if r.operation not in EVIDENCE_ONLY_OPERATIONS)
    has_previous_row = any(r.operation == OperationKind.PREVIOUS_BALANCE for r in rows)
    variants = [("todas as linhas", everything), ("só lançamentos do ciclo", new_only)]
    if previous is not None and previous.value is not None and not has_previous_row:
        variants.append(("fatura anterior + linhas", previous.value + everything))
    for label, value in variants:
        if value == total.value:
            return Check("invoice_total", True, f"total confere ({label})", total.value, value)
    closest = min(variants, key=lambda item: abs(item[1] - total.value))
    return Check("invoice_total", False, f"total não confere; mais próximo: {closest[0]}", total.value, closest[1])
