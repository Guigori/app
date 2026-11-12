"""NFC-e / NF-e DANFE extractor (consumer receipts).

Reads the issuer, CNPJ, emission date, items, total, payment methods and the
44-digit access key, then cross-checks them deterministically:

* CNPJ check digits;
* access-key check digit (mod 11), and the key's own CNPJ, model, series,
  number and year/month against what is printed;
* items add up to the total (minus discounts), payments minus change equal
  the total, quantity × unit price equals each item total.

The result is one purchase candidate for review. Nothing is consulted online
(the SEFAZ link is kept as evidence only) and nothing is written anywhere.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

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
from finnos.document_intelligence.parsers import confidence_level, finalize

UF_CODES = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI",
    "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
    "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
}

# Payment method names printed on DANFE (tPag) -> FINNOS wallet kind.
PAYMENT_KINDS = (
    ("vale refeicao", "beneficio_refeicao"), ("vale alimentacao", "beneficio_alimentacao"),
    ("cartao de credito", "credito"), ("credito", "credito"), ("cartao de debito", "debito"), ("debito", "debito"),
    ("pix", "pix"), ("dinheiro", "dinheiro"), ("vale presente", "outro"), ("vale combustivel", "beneficio_combustivel"),
    ("boleto", "boleto"), ("transferencia", "transferencia"), ("carteira digital", "carteira_digital"),
)

_CNPJ_RE = re.compile(r"CNPJ\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})", re.IGNORECASE)
_ITEM_RE = re.compile(
    r"^\s*(?P<code>\d{3,14})\s+(?P<desc>.+?)\s+(?P<qty>\d+(?:[.,]\d{1,4})?)\s+(?P<unit>[A-Za-z]{1,4})\s+"
    r"(?P<price>\d{1,3}(?:\.\d{3})*,\d{2,4})\s+(?P<total>(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2})\s*$"
)


def valid_cnpj(digits: str) -> bool:
    if not re.fullmatch(r"\d{14}", digits) or len(set(digits)) == 1:
        return False

    def dv(base: str, weights: list[int]) -> int:
        rest = sum(int(d) * w for d, w in zip(base, weights, strict=True)) % 11
        return 0 if rest < 2 else 11 - rest

    first = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    return dv(digits[:12], first) == int(digits[12]) and dv(digits[:13], [6, *first]) == int(digits[13])


def access_key_dv(first_43: str) -> int:
    weights = [2, 3, 4, 5, 6, 7, 8, 9]
    total = sum(int(d) * weights[i % 8] for i, d in enumerate(reversed(first_43)))
    dv = 11 - total % 11
    return 0 if dv >= 10 else dv


@dataclass(frozen=True)
class AccessKey:
    digits: str

    @property
    def uf(self) -> str | None:
        return UF_CODES.get(self.digits[:2])

    @property
    def year_month(self) -> str:
        return f"20{self.digits[2:4]}-{self.digits[4:6]}"

    @property
    def cnpj(self) -> str:
        return self.digits[6:20]

    @property
    def model(self) -> str:
        return self.digits[20:22]  # 65 = NFC-e, 55 = NF-e

    @property
    def series(self) -> int:
        return int(self.digits[22:25])

    @property
    def number(self) -> int:
        return int(self.digits[25:34])

    @property
    def check_digit_ok(self) -> bool:
        return access_key_dv(self.digits[:43]) == int(self.digits[43])


def _ev(span: TextSpan) -> Evidence:
    return Evidence(span.page, span.text, span.bounding_box)


def _field(value, raw, span: TextSpan, engine: str, certainty: float = 0.98, status=ValidationStatus.VALID) -> ExtractedField:
    return ExtractedField(value, raw, round(min(certainty, span.confidence), 4), engine, _ev(span), status.value)


def _find_access_key(spans: Sequence[TextSpan]) -> tuple[str, list[TextSpan]]:
    """44 digits printed in groups of 4, often wrapping onto the next line."""
    for index, span in enumerate(spans):
        if "chave de acesso" not in fold(span.text):
            continue
        digits, used = "", []
        for candidate in spans[index + 1:index + 4]:
            found = re.sub(r"\D", "", re.sub(r"(?i)^\s*nf-?c?e\s*", "", candidate.text))
            if not found:
                continue
            digits += found
            used.append(candidate)
            if len(digits) >= 44:
                break
        if len(digits) == 44:
            return digits, used
    for span in spans:  # keys printed on one line, without the label
        match = re.search(r"(?:\d{4}\s?){11}", span.text)
        if match and len(re.sub(r"\D", "", match.group(0))) == 44:
            return re.sub(r"\D", "", match.group(0)), [span]
    return "", []


def _amount_after(span: TextSpan, label_end: int = 0) -> tuple[int | None, str]:
    tokens = find_amount_tokens(span.text[label_end:])
    if not tokens:
        return None, ""
    raw = tokens[-1].group("token").strip()
    try:
        return parse_amount(raw).cents, raw
    except ValueError:
        return None, raw


def _decimal(raw: str) -> float:
    return float(raw.replace(".", "").replace(",", ".")) if "," in raw else float(raw)


@dataclass
class FiscalExtraction:
    fields: dict[str, ExtractedField]
    rows: list[ExtractedTransaction]
    checks: list[Check]
    warnings: list[str]
    items: list[dict]
    payments: list[dict]


def extract_fiscal_receipt(spans: Sequence[TextSpan], *, source_engine: str) -> FiscalExtraction:
    fields: dict[str, ExtractedField] = {}
    checks: list[Check] = []
    warnings: list[str] = []
    items: list[dict] = []
    payments: list[dict] = []

    # Issuer: the line right before the first CNPJ line (legal name).
    for index, span in enumerate(spans):
        match = _CNPJ_RE.search(span.text)
        if not match:
            continue
        digits = re.sub(r"\D", "", match.group(1))
        ok = valid_cnpj(digits)
        fields["issuer_cnpj"] = _field(digits, match.group(1), span, source_engine,
                                       status=ValidationStatus.VALID if ok else ValidationStatus.INVALID)
        checks.append(Check("cnpj_check_digits", ok, "dígitos verificadores do CNPJ do emitente"))
        for previous in reversed(spans[max(0, index - 3):index]):
            name = previous.text.strip()
            if re.search(r"[A-Za-zÀ-ú]{3}", name) and not re.fullmatch(r"(?i)nf-?c?-?e|danfe.*", name):
                fields["issuer_name"] = _field(name, name, previous, source_engine, certainty=0.95)
                break
        break

    model = "65" if any("nfc-e" in fold(s.text) for s in spans[:12]) else None
    emission_span = next((s for s in spans if "emissao" in fold(s.text)), None)
    if emission_span is not None:
        match = re.search(r"(\d{2}/\d{2}/\d{4})", emission_span.text)
        if match:
            fields["issue_date"] = _field(parse_ptbr_date(match.group(1)), match.group(1), emission_span, source_engine)
        number = re.search(r"(?i)n[uú]mero\s*:?\s*(\d+)", emission_span.text)
        series = re.search(r"(?i)s[eé]rie\s*:?\s*(\d+)", emission_span.text)
        if number:
            fields["number"] = _field(int(number.group(1)), number.group(1), emission_span, source_engine)
        if series:
            fields["series"] = _field(int(series.group(1)), series.group(1), emission_span, source_engine)
        index = list(spans).index(emission_span)
        time = re.search(r"\b(\d{2}:\d{2}(?::\d{2})?)\b", " ".join(s.text for s in spans[index:index + 2]))
        if time:
            fields["issue_time"] = _field(time.group(1), time.group(1), emission_span, source_engine)

    # Items: code, description, quantity, unit, unit price, total.
    in_items = False
    for span in spans:
        folded = fold(span.text)
        if "descricao" in folded and ("qtd" in folded or "total" in folded):
            in_items = True
            continue
        if in_items and ("qtd. total" in folded or "qtd total" in folded or folded.startswith("valor total")):
            in_items = False
        if not in_items:
            continue
        match = _ITEM_RE.match(" ".join(span.text.split()))
        if not match:
            warnings.append("item_line_not_parsed")
            continue
        total = parse_amount(match.group("total")).cents
        qty, price = _decimal(match.group("qty")), _decimal(match.group("price"))
        consistent = abs(round(qty * price * 100) - total) <= 1
        items.append({
            "code": match.group("code"), "description": match.group("desc").strip(), "quantity": qty,
            "unit": match.group("unit"), "unit_price": price, "total_cents": total,
            "confidence": round(span.confidence, 4), "consistent": consistent,
            "evidence": _ev(span).to_dict(),
        })
        if not consistent:
            warnings.append("item_quantity_times_price_mismatch")

    def labelled(label: str, *, exclude: tuple[str, ...] = ()) -> tuple[int | None, str, TextSpan | None]:
        for span in spans:
            folded = fold(span.text)
            if folded.strip().startswith(label) and not any(term in folded for term in exclude):
                cents, raw = _amount_after(span, len(label))
                return cents, raw, span
        return None, "", None

    total, raw_total, total_span = labelled("valor total")
    if total is None:
        total, raw_total, total_span = labelled("valor a pagar")
    if total is not None and total_span is not None:
        fields["total_cents"] = _field(total, raw_total, total_span, source_engine)
    discount, raw_discount, discount_span = labelled("desconto")
    if discount and discount_span is not None:
        fields["discount_cents"] = _field(discount, raw_discount, discount_span, source_engine)
    change, raw_change, change_span = labelled("troco")
    if change is not None and change_span is not None:
        fields["change_cents"] = _field(change, raw_change, change_span, source_engine)

    in_payments = False
    for span in spans:
        folded = fold(span.text)
        if folded.startswith("forma de pagamento") or folded.startswith("forma pagamento"):
            in_payments = True
            continue
        if in_payments and (folded.startswith("troco") or folded.startswith("tributos")):
            break
        if not in_payments:
            continue
        cents, raw = _amount_after(span)
        name = re.sub(r"(?i)\s*R\s?\$?\s*[\d.,]+\s*$", "", span.text).strip(" -–")
        if cents is None or not name:
            continue
        kind = next((k for term, k in PAYMENT_KINDS if term in fold(name)), "outro")
        payments.append({"method": name, "kind": kind, "amount_cents": cents, "evidence": _ev(span).to_dict()})
    if payments:
        first = payments[0]
        fields["payment_method"] = ExtractedField(
            first["kind"], first["method"], 0.95, source_engine,
            Evidence(**{k: v for k, v in first["evidence"].items()}), ValidationStatus.VALID.value)

    key_digits, key_spans = _find_access_key(spans)
    if key_digits:
        key = AccessKey(key_digits)
        fields["access_key"] = _field(key_digits, " ".join(s.text for s in key_spans), key_spans[0], source_engine,
                                      status=ValidationStatus.VALID if key.check_digit_ok else ValidationStatus.INVALID)
        checks.append(Check("access_key_check_digit", key.check_digit_ok, "dígito verificador da chave de acesso"))
        if "issuer_cnpj" in fields:
            checks.append(Check("access_key_cnpj", key.cnpj == fields["issuer_cnpj"].value,
                                "CNPJ dentro da chave = CNPJ impresso"))
        if "number" in fields:
            checks.append(Check("access_key_number", key.number == fields["number"].value,
                                "número dentro da chave = número impresso"))
        if "series" in fields:
            checks.append(Check("access_key_series", key.series == fields["series"].value,
                                "série dentro da chave = série impressa"))
        if "issue_date" in fields:
            checks.append(Check("access_key_month", fields["issue_date"].value.startswith(key.year_month),
                                "ano/mês dentro da chave = data de emissão"))
        if model and key.model != model:
            warnings.append("access_key_model_differs_from_header")
        fields["document_model"] = _field({"65": "nfce", "55": "nfe"}.get(key.model, key.model), key.model,
                                          key_spans[0], source_engine)
        if key.uf:
            fields["issuer_uf"] = _field(key.uf, key_digits[:2], key_spans[0], source_engine)
    else:
        warnings.append("access_key_not_found")

    if total is not None:
        if items:
            expected = sum(i["total_cents"] for i in items) - (discount or 0)
            checks.append(Check("items_total", expected == total, "itens - desconto = valor total", total, expected))
        if payments:
            paid = sum(p["amount_cents"] for p in payments) - (change or 0)
            checks.append(Check("payments_total", paid == total, "pagamentos - troco = valor total", total, paid))
    else:
        warnings.append("total_not_found")

    # Items and payments are read from other lines: when both add up to the
    # printed total, the total is confirmed three times over.
    if total is not None and sum(1 for c in checks if c.name in {"items_total", "payments_total"} and c.passed) == 2:
        import dataclasses

        fields["total_cents"] = dataclasses.replace(fields["total_cents"], confidence=0.99)

    rows: list[ExtractedTransaction] = []
    if total is not None and total_span is not None:
        date_field = fields.get("issue_date")
        name_field = fields.get("issuer_name")
        row = ExtractedTransaction(
            transaction_date=date_field,
            description=name_field,
            amount_cents=fields["total_cents"],
            direction=Direction.EXPENSE,
            operation=OperationKind.PURCHASE,
            checks=list(checks),
            warnings=list(warnings),
        )
        scores = [f.confidence for f in (date_field, name_field, fields["total_cents"]) if f is not None]
        if date_field is None or name_field is None:
            scores.append(0.5)
        # HIGH needs the money to close: items or payments must match the total.
        money_ok = any(c.name in {"items_total", "payments_total"} and c.passed for c in checks)
        finalize(row, scores + [0.99 if money_ok else 0.9])
        rows.append(row)
    for row in rows:
        row.confidence_level = confidence_level(row.confidence)
    return FiscalExtraction(fields, rows, checks, warnings, items, payments)
