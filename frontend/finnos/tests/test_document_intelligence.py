"""Deterministic FDI core: Brazilian normalization, provenance and conservative parsing."""
import pytest

from finnos.document_intelligence.engines import EngineRegistry, EngineUnavailableError
from finnos.document_intelligence.models import (
    ConfidenceLevel,
    Direction,
    DocumentKind,
    TextSpan,
)
from finnos.document_intelligence.normalization import parse_brl_cents, parse_ptbr_date
from finnos.document_intelligence.parsers import parse_statement_span
from finnos.document_intelligence.service import classify_document, extract_text_document


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("R$ 1.234,56", 123456),
        ("1.234,56", 123456),
        ("-15,90", -1590),
        ("1234.56", 123456),
        ("1.234", 123400),
        ("0,01", 1),
        ("R$ 0,00", 0),
    ],
)
def test_parse_brl_cents(raw, expected):
    assert parse_brl_cents(raw) == expected


@pytest.mark.parametrize("raw", ["", "R$", "1,234,56", "12.34.56", "1.234,567", "abc"])
def test_parse_brl_cents_rejects_malformed_or_ambiguous_values(raw):
    with pytest.raises(ValueError):
        parse_brl_cents(raw)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("12/11/2026", "2026-11-12"),
        ("01/02/26", "2026-02-01"),
    ],
)
def test_parse_ptbr_date(raw, expected):
    assert parse_ptbr_date(raw) == expected


def test_statement_row_keeps_evidence_and_does_not_guess_unsigned_direction():
    span = TextSpan("12/11/2026 MERCADO EXEMPLO 125,90", page=2, bounding_box=(0.1, 0.2, 0.8, 0.3))
    row = parse_statement_span(span, source_engine="fixture_ocr")

    assert row is not None
    assert row.transaction_date.value == "2026-11-12"
    assert row.amount_cents.value == 12590
    assert row.direction == Direction.UNKNOWN
    assert "direction_not_explicit" in row.warnings
    assert row.amount_cents.evidence.page == 2
    assert row.amount_cents.evidence.bounding_box == (0.1, 0.2, 0.8, 0.3)
    assert row.confidence_level == ConfidenceLevel.MEDIUM


def test_statement_row_respects_explicit_debit_credit_marker():
    debit = parse_statement_span(TextSpan("12/11/2026 MERCADO -125,90 D"), source_engine="ocr")
    credit = parse_statement_span(TextSpan("12/11/2026 SALARIO 3500,00 C"), source_engine="ocr")

    assert debit.direction == Direction.EXPENSE
    assert credit.direction == Direction.INCOME


def test_document_classifier_is_conservative():
    assert classify_document("Extrato da conta Saldo anterior") == DocumentKind.BANK_STATEMENT
    assert classify_document("Fatura do cartão Total da fatura") == DocumentKind.CREDIT_CARD_STATEMENT
    assert classify_document("arquivo qualquer") == DocumentKind.UNKNOWN


def test_text_extraction_is_review_only_and_json_compatible():
    result = extract_text_document(
        [
            TextSpan("Extrato da conta Saldo anterior"),
            TextSpan("12/11/2026 MERCADO EXEMPLO -125,90 D", page=2),
        ],
        document_id="fixture-001",
        source_engine="native_text",
    )

    payload = result.to_dict()
    assert result.document_kind == DocumentKind.BANK_STATEMENT
    assert payload["status"] == "pending_review"
    assert payload["transactions"][0]["amount_cents"]["value"] == 12590
    assert payload["transactions"][0]["direction"] == "expense"
    assert payload["transactions"][0]["amount_cents"]["evidence"]["page"] == 2


def test_engine_registry_does_not_require_provider_at_import_time():
    registry = EngineRegistry()
    assert registry.names() == ()
    with pytest.raises(EngineUnavailableError):
        registry.get("paddleocr")
