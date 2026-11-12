"""Application service for text-first extraction.

OCR engines and the native PDF reader all produce ``TextSpan`` lines. This
keeps financial interpretation independent from PaddleOCR, Tesseract, cloud
APIs, or LLMs. Nothing in this module writes to accounts, cards, Firestore or
the Ledger: results always start as ``pending_review``.
"""
from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable

from finnos.document_intelligence.extractors import extract_bank_statement, extract_card_invoice
from finnos.document_intelligence.institutions import identify_institution
from finnos.document_intelligence.models import (
    DocumentKind,
    Evidence,
    ExtractedField,
    ExtractionResult,
    TextSpan,
    ValidationStatus,
)
from finnos.document_intelligence.normalization import fold

# (kind, required-any, supporting) — a kind needs one *strong* phrase; the
# supporting phrases only break ties. Generic words like "consumidor" or
# "valor total" are never enough on their own.
_KIND_RULES: tuple[tuple[DocumentKind, tuple[str, ...], tuple[str, ...]], ...] = (
    (DocumentKind.CREDIT_CARD_STATEMENT,
     ("fatura do cartao", "fatura do seu cartao", "total da fatura", "vencimento da fatura", "pagamento minimo",
      "fatura de cartao", "resumo da fatura"),
     ("limite", "vencimento", "parcela", "anuidade")),
    (DocumentKind.BANK_STATEMENT,
     ("extrato da conta", "extrato de conta", "extrato bancario", "extrato conta corrente", "extrato mensal",
      "saldo anterior", "saldo disponivel", "extrato"),
     ("saldo", "agencia", "conta corrente", "lancamentos")),
    (DocumentKind.PAYMENT_RECEIPT,
     ("comprovante pix", "comprovante de pix", "comprovante de transferencia", "comprovante de pagamento",
      "id da transacao", "id e2e", "end to end"),
     ("pagador", "recebedor", "favorecido")),
    (DocumentKind.FISCAL_DOCUMENT,
     ("danfe", "nota fiscal eletronica", "nf-e", "nfc-e", "chave de acesso"),
     ("cnpj", "emitente")),
    (DocumentKind.PURCHASE_RECEIPT,
     ("cupom fiscal", "cf-e", "extrato do cupom", "sat fiscal"),
     ("consumidor", "valor total", "itens")),
)


def classify_with_score(text: str) -> tuple[DocumentKind, float, str]:
    """Return (kind, confidence, matched phrase). UNKNOWN beats a false label."""
    normalized = re.sub(r"\s+", " ", fold(text))
    best: tuple[DocumentKind, float, str] = (DocumentKind.UNKNOWN, 0.0, "")
    for kind, strong, support in _KIND_RULES:
        hits = [term for term in strong if term in normalized]
        if not hits:
            continue
        # "extrato" alone is weak (an invoice says "extrato da fatura" too).
        weak_only = hits == ["extrato"]
        score = 0.80 if weak_only else 0.95
        score += 0.01 * sum(1 for term in support if term in normalized)
        score += 0.01 * (len(hits) - 1)
        if score > best[1]:
            best = (kind, min(score, 0.99), hits[0])
    return best


def classify_document(text: str) -> DocumentKind:
    return classify_with_score(text)[0]


def extract_text_document(
    spans: Iterable[TextSpan],
    *,
    document_id: str | None = None,
    source_engine: str = "native_text",
    document_kind: DocumentKind | None = None,
) -> ExtractionResult:
    """Extract candidates from already-recognised text lines (review only)."""
    materialized = [span for span in spans if span.text.strip()]
    joined = "\n".join(span.text for span in materialized)
    resolved_id = document_id or "text-" + hashlib.sha256(joined.encode("utf-8")).hexdigest()
    if document_kind is None:
        kind, kind_confidence, phrase = classify_with_score(joined)
    else:
        kind, kind_confidence, phrase = document_kind, 1.0, "declared"

    result = ExtractionResult(
        document_id=resolved_id,
        document_kind=kind,
        source_engine=source_engine,
        pages=max((span.page for span in materialized), default=0),
        engines_used=[source_engine],
    )
    if materialized:
        first = materialized[0]
        result.fields["document_kind"] = ExtractedField(
            kind.value, phrase, round(kind_confidence, 4), source_engine,
            Evidence(first.page, first.text, first.bounding_box),
            ValidationStatus.VALID.value if kind_confidence >= 0.95 else ValidationStatus.NOT_VALIDATED.value,
        )

    institution, institution_warnings = identify_institution(materialized, source_engine=source_engine)
    if institution is not None:
        result.fields["institution"] = institution
    result.warnings.extend(institution_warnings)

    if kind == DocumentKind.CREDIT_CARD_STATEMENT:
        extraction = extract_card_invoice(materialized, source_engine=source_engine)
    elif kind == DocumentKind.BANK_STATEMENT:
        extraction = extract_bank_statement(materialized, source_engine=source_engine)
    else:
        result.warnings.append("transaction_row_parser_requires_statement_document")
        return result

    result.fields.update(extraction.fields)
    result.transactions = extraction.rows
    result.checks = extraction.checks
    result.warnings.extend(extraction.warnings)
    if not result.transactions and "no_transaction_rows_found" not in result.warnings:
        result.warnings.append("no_transaction_rows_found")
    return result
