"""Application service for text-first extraction.

OCR engines implement the same TextSpan contract. This keeps financial
interpretation independent from PaddleOCR, Tesseract, cloud APIs, or LLMs.
"""
import hashlib
import re
from collections.abc import Iterable

from finnos.document_intelligence.models import (
    DocumentKind,
    ExtractionResult,
    TextSpan,
)
from finnos.document_intelligence.parsers import parse_statement_span


def classify_document(text: str) -> DocumentKind:
    """Conservative keyword classifier; UNKNOWN is preferred over a false label."""
    normalized = re.sub(r"\s+", " ", text.casefold())
    if any(term in normalized for term in ("fatura do cartão", "total da fatura", "vencimento da fatura")):
        return DocumentKind.CREDIT_CARD_STATEMENT
    if any(term in normalized for term in ("extrato da conta", "saldo anterior", "saldo disponível")):
        return DocumentKind.BANK_STATEMENT
    if any(term in normalized for term in ("comprovante pix", "id da transação", "e2e")):
        return DocumentKind.PAYMENT_RECEIPT
    if any(term in normalized for term in ("danfe", "nota fiscal eletrônica", "chave de acesso")):
        return DocumentKind.FISCAL_DOCUMENT
    if any(term in normalized for term in ("cupom fiscal", "consumidor", "valor total")):
        return DocumentKind.PURCHASE_RECEIPT
    return DocumentKind.UNKNOWN


def extract_text_document(
    spans: Iterable[TextSpan],
    *,
    document_id: str | None = None,
    source_engine: str = "native_text",
    document_kind: DocumentKind | None = None,
) -> ExtractionResult:
    """Extract candidate statement rows from already-recognized text.

    This stage never writes to FINNOS accounts, transactions, Firestore, or Ledger.
    """
    materialized = list(spans)
    joined = "\n".join(span.text for span in materialized)
    resolved_id = document_id or hashlib.sha256(joined.encode("utf-8")).hexdigest()
    kind = document_kind or classify_document(joined)
    result = ExtractionResult(
        document_id=resolved_id,
        document_kind=kind,
        source_engine=source_engine,
    )

    if kind not in {DocumentKind.BANK_STATEMENT, DocumentKind.CREDIT_CARD_STATEMENT}:
        result.warnings.append("transaction_row_parser_requires_statement_document")
        return result

    for span in materialized:
        candidate = parse_statement_span(span, source_engine=source_engine)
        if candidate is not None:
            result.transactions.append(candidate)

    if not result.transactions:
        result.warnings.append("no_confident_transaction_rows_found")
    return result
