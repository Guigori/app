"""FDI engine: regressions from the foundation audit, invoices, statements,
issuer detection, routing, review and engine adapters. Synthetic data only."""
import subprocess
import sys

import pytest

from finnos.document_intelligence.engines import EngineRegistry, PaddleOCREngine
from finnos.document_intelligence.extractors import extract_bank_statement, extract_card_invoice
from finnos.document_intelligence.institutions import identify_institution
from finnos.document_intelligence.models import (
    ConfidenceLevel,
    Direction,
    DocumentKind,
    OperationKind,
    ReviewStatus,
    TextSpan,
)
from finnos.document_intelligence.normalization import infer_year, parse_amount, parse_brl_cents, parse_ptbr_date
from finnos.document_intelligence.parsers import parse_statement_span, split_line
from finnos.document_intelligence.processor import (
    DocumentRejected,
    ProcessingPolicy,
    document_identity,
    process_document,
    sniff_file_type,
)
from finnos.document_intelligence.review import ReviewError, ReviewSession
from finnos.document_intelligence.service import classify_document, extract_text_document


def spans(text: str) -> list[TextSpan]:
    return [TextSpan(line) for line in text.strip().splitlines()]


# ---------------------------------------------------------------- audit regressions


def test_balance_column_is_never_taken_as_the_amount():
    row = parse_statement_span(TextSpan("12/11/2026 PIX ENVIADO 100,00 5.000,00"), source_engine="t")
    assert row.amount_cents.value is None
    assert row.description.value == "PIX ENVIADO"
    assert "multiple_amount_columns" in row.warnings
    assert row.confidence_level == ConfidenceLevel.LOW


@pytest.mark.parametrize("raw", ["1234.567", "12.34.56", "1,5", "1.234,5", "--10,00-", "+10,00-"])
def test_ambiguous_amounts_fail_closed(raw):
    with pytest.raises(ValueError):
        parse_amount(raw)


@pytest.mark.parametrize(
    ("raw", "cents", "sign"),
    [("125,90-", 12590, -1), ("(125,90)", 12590, -1), ("R$ -125,90", 12590, -1), ("-R$ 125,90", 12590, -1),
     ("-R$-450,00", 45000, -1), ("+10,00", 1000, 1), ("1.234.567,89", 123456789, None), ("1234.56", 123456, None)],
)
def test_amount_sign_sources(raw, cents, sign):
    parsed = parse_amount(raw)
    assert (parsed.cents, parsed.sign) == (cents, sign)


def test_trailing_minus_and_currency_do_not_leak_into_description():
    row = parse_statement_span(TextSpan("12/11/2026 COMPRA MERCADO 125,90-"), source_engine="t")
    assert (row.amount_cents.value, row.direction) == (12590, Direction.EXPENSE)
    row = parse_statement_span(TextSpan("12/11/2026 MERCADO R$ -125,90"), source_engine="t")
    assert row.description.value == "MERCADO"


def test_sign_and_marker_conflict_is_flagged_not_resolved():
    row = parse_statement_span(TextSpan("12/11/2026 ESTORNO -50,00 C"), source_engine="t")
    assert row.direction == Direction.UNKNOWN
    assert "sign_marker_conflict" in row.warnings
    assert row.confidence_level == ConfidenceLevel.LOW


def test_classifier_needs_a_strong_phrase():
    assert classify_document("Cupom de desconto para o consumidor") == DocumentKind.UNKNOWN
    assert classify_document("Comprovante qualquer valor total R$ 10") == DocumentKind.UNKNOWN
    assert classify_document("Resumo da fatura  Pagamento mínimo") == DocumentKind.CREDIT_CARD_STATEMENT


def test_row_confidence_is_the_weakest_field_not_the_average():
    row = parse_statement_span(TextSpan("32/13/2026 LOJA 10,00 D"), source_engine="t")
    assert row.transaction_date.value is None
    assert row.confidence <= 0.2


def test_dates_without_year_follow_the_cycle():
    from datetime import date

    assert infer_year(28, 12, date(2027, 1, 10)).isoformat() == "2026-12-28"
    assert infer_year(5, 1, date(2027, 1, 10)).isoformat() == "2027-01-05"
    assert parse_ptbr_date("12 NOV 2026") == "2026-11-12"
    assert parse_brl_cents("-15,90") == -1590


# ---------------------------------------------------------------- credit card invoice

INVOICE = """
Banco Itaucard S.A. CNPJ 17.192.451/0001-70
Resumo da fatura - DOCUMENTO SINTETICO
Cartão final 9876
Vencimento 10/01/2027
Total desta fatura R$ 1.245,56
Pagamento mínimo R$ 150,00
15/12 PAGAMENTO RECEBIDO -500,00
28/12 MERCADO EXEMPLO 300,00
20/12 LOJA DE ROUPAS PARC 03/10 120,00
21/12 ELETRO CASA 02 DE 06 80,00
22/12 LIVRARIA Parcela 1/2 40,00
02/01 IOF COMPRA INTERNACIONAL 1,56
02/01 LOJA ONLINE US$ 20,00 110,00
03/01 ESTORNO LOJA X -50,00
29/12 JUROS DE MORA 3,00
29/12 JUROS ROTATIVO 7,00
29/12 MULTA 2,00
29/12 ENCARGOS FINANCIAMENTO 5,00
30/12 ANUIDADE 10,00
31/12 CASHBACK -4,00
05/12 FATURA ANTERIOR 1.121,00
"""


def test_invoice_full_cycle():
    result = extract_text_document(spans(INVOICE))
    assert result.document_kind == DocumentKind.CREDIT_CARD_STATEMENT
    assert result.fields["institution"].value == "itau"
    assert result.fields["due_date"].value == "2027-01-10"
    assert result.fields["total_cents"].value == 124556
    assert result.fields["card_last_digits"].value == "9876"
    by_desc = {row.description.value: row for row in result.transactions}
    assert by_desc["PAGAMENTO RECEBIDO"].operation == OperationKind.INVOICE_PAYMENT
    assert by_desc["PAGAMENTO RECEBIDO"].direction == Direction.INCOME
    assert by_desc["LOJA DE ROUPAS"].installment.to_dict() == {"current": 3, "total": 10}
    assert by_desc["ELETRO CASA"].installment.to_dict() == {"current": 2, "total": 6}
    assert by_desc["LIVRARIA"].installment.to_dict() == {"current": 1, "total": 2}
    assert by_desc["LOJA ONLINE"].amount_cents.value == 11000  # BRL, not the US$ column
    assert by_desc["MERCADO EXEMPLO"].transaction_date.value == "2026-12-28"
    expected = {
        "IOF COMPRA INTERNACIONAL": OperationKind.IOF, "ESTORNO LOJA X": OperationKind.REFUND,
        "JUROS DE MORA": OperationKind.LATE_INTEREST, "JUROS ROTATIVO": OperationKind.INTEREST,
        "MULTA": OperationKind.LATE_FEE, "ENCARGOS FINANCIAMENTO": OperationKind.CHARGES,
        "ANUIDADE": OperationKind.ANNUAL_FEE, "CASHBACK": OperationKind.CREDIT,
        "FATURA ANTERIOR": OperationKind.PREVIOUS_BALANCE,
    }
    for description, operation in expected.items():
        assert by_desc[description].operation == operation, description
    assert by_desc["ESTORNO LOJA X"].direction == Direction.INCOME
    total = next(c for c in result.checks if c.name == "invoice_total")
    assert total.passed is True
    assert all(row.confidence_level == ConfidenceLevel.HIGH for row in result.transactions)


def test_invoice_with_a_missing_line_fails_the_total_and_nothing_stays_high():
    text = INVOICE.replace("29/12 MULTA 2,00\n", "")
    result = extract_text_document(spans(text))
    assert next(c for c in result.checks if c.name == "invoice_total").passed is False
    assert "invoice_total_mismatch" in result.warnings
    assert all(row.confidence_level != ConfidenceLevel.HIGH for row in result.transactions)


def test_negative_line_without_keyword_is_a_credit():
    result = extract_card_invoice(spans("Vencimento 10/01/2027\n03/01 LOJA X -50,00"), source_engine="t")
    row = result.rows[0]
    assert (row.direction, row.operation) == (Direction.INCOME, OperationKind.CREDIT)
    assert "credit_without_keyword" in row.warnings


def test_invoice_without_due_date_cannot_place_day_month_rows():
    result = extract_card_invoice(spans("Fatura do cartão\n28/12 MERCADO 10,00"), source_engine="t")
    assert result.rows[0].transaction_date.value is None
    assert "due_date_not_found" in result.warnings


# ---------------------------------------------------------------- bank statement

STATEMENT = """
Banco Inter S.A. CNPJ 00.416.968/0001-01
Extrato da conta corrente
Período: 01/10/2026 a 31/10/2026
Data Descrição Valor Saldo
01/10/2026 SALDO ANTERIOR 1.000,00
02/10/2026 PIX RECEBIDO JOAO 500,00 1.500,00
03/10/2026 COMPRA DEBITO MERCADO 120,50 1.379,50
05/10/2026 PIX ENVIADO NUBANK 100,00 1.279,50
31/10/2026 SALDO FINAL 1.279,50
"""


def test_statement_running_balance_decides_unsigned_directions():
    result = extract_text_document(spans(STATEMENT))
    assert result.fields["institution"].value == "inter"  # 'NUBANK' in a row is not the issuer
    rows = result.transactions
    assert [r.direction for r in rows] == [Direction.INCOME, Direction.EXPENSE, Direction.EXPENSE]
    assert [r.balance_cents.value for r in rows] == [150000, 137950, 127950]
    assert next(c for c in result.checks if c.name == "statement_balance").passed is True
    assert all(any(c.name == "running_balance" and c.passed for c in r.checks) for r in rows)


def test_statement_balance_that_does_not_close_is_flagged():
    result = extract_text_document(spans(STATEMENT.replace("1.279,50\n31/10", "1.279,00\n31/10")))
    assert any(not c.passed for r in result.transactions for c in r.checks if c.name == "running_balance")
    assert all(r.confidence_level != ConfidenceLevel.HIGH for r in result.transactions)


def test_statement_with_dc_markers_and_no_balance_column():
    text = """Extrato de conta corrente
Período: 01/10/2026 a 31/10/2026
01/10/2026 SALDO ANTERIOR 300,00 C
02/10/2026 PIX RECEBIDO MARIA 500,00 C
03/10/2026 TARIFA PACOTE 29,90 D
31/10/2026 SALDO FINAL 770,10 C"""
    result = extract_bank_statement(spans(text), source_engine="t")
    assert [(r.amount_cents.value, r.direction) for r in result.rows] == [
        (50000, Direction.INCOME), (2990, Direction.EXPENSE)]
    assert result.checks[-1].passed is True


# ---------------------------------------------------------------- institutions


def test_issuer_by_cnpj_beats_brand_words_and_conflicts_return_nothing():
    field, _ = identify_institution(spans("Banco do Brasil S.A. CNPJ 00.000.000/0001-91\nExtrato"), source_engine="t")
    assert (field.value, field.confidence) == ("bb", 0.99)
    field, warnings = identify_institution(
        spans("Itaú Unibanco S.A.\nBanco Bradesco S.A.\nExtrato"), source_engine="t")
    assert field is None and warnings[0].startswith("institution_conflict")
    field, warnings = identify_institution(spans("Extrato qualquer"), source_engine="t")
    assert field is None and warnings == ["institution_not_identified"]


# ---------------------------------------------------------------- routing and safety


def test_file_type_comes_from_bytes_and_ids_are_uid_scoped():
    assert sniff_file_type(b"%PDF-1.7 ...") == "pdf"
    with pytest.raises(DocumentRejected):
        sniff_file_type(b"MZ\x90\x00 executable renamed to .pdf")
    hash_a, id_a = document_identity("user-a", b"%PDF-1.7 same")
    hash_b, id_b = document_identity("user-b", b"%PDF-1.7 same")
    assert hash_a == hash_b and id_a != id_b
    with pytest.raises(DocumentRejected):
        process_document(b"%PDF-" + b"0" * 100, uid="u", policy=ProcessingPolicy(max_bytes=50))


def test_light_target_never_runs_ocr_and_ocr_needs_consent():
    pil = pytest.importorskip("PIL.Image")
    import io

    buffer = io.BytesIO()
    pil.new("L", (200, 100), 255).save(buffer, format="PNG")
    outcome = process_document(buffer.getvalue(), uid="u", target="light")
    assert outcome.needs_ocr_worker is True and outcome.result is None
    assert outcome.route == ["stopped_before_ocr"]
    with pytest.raises(DocumentRejected, match="consent"):
        process_document(buffer.getvalue(), uid="u", target="ocr_worker", registry=EngineRegistry())


def test_fdi_package_does_not_import_firebase_or_financial_writers():
    code = (
        "import sys, finnos.document_intelligence.processor, finnos.document_intelligence.review;"
        "bad=[m for m in sys.modules if m.startswith(('firebase_admin','google.cloud','finnos.lib.db','finnos.routers','paddle','pdfplumber'))];"
        "print(bad); sys.exit(1 if bad else 0)"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=".")
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------- review


def _reviewable():
    result = extract_text_document(spans(INVOICE), document_id="doc-1")
    return ReviewSession(result=result, uid="user-1", content_hash="abc")


def test_review_keeps_original_reading_and_blocks_until_every_row_is_decided():
    session = _reviewable()
    with pytest.raises(ReviewError):
        session.confirm(actor="user-1", at="2026-11-12T10:00:00-03:00")
    session.correct(1, "amount_cents", 30100, actor="user-1", at="2026-11-12T10:00:00-03:00", reason="nota")
    corrected = session.result.transactions[1].amount_cents
    assert corrected.value == 30000 and corrected.effective_value == 30100
    assert corrected.correction.original_value == 30000
    for index in range(len(session.result.transactions)):
        if index != 1:
            session.accept(index, actor="user-1", at="2026-11-12T10:01:00-03:00")
    # The correction no longer closes with the printed total: the person must say why.
    with pytest.raises(ReviewError, match="invoice_total"):
        session.confirm(actor="user-1", at="2026-11-12T10:02:00-03:00")
    session.acknowledge_check("invoice_total", actor="user-1", at="2026-11-12T10:02:00-03:00",
                              note="valor da nota fiscal")
    session.confirm(actor="user-1", at="2026-11-12T10:02:00-03:00")
    assert session.result.status == ReviewStatus.REVIEWED
    first = session.prepare_import()
    assert first == session.prepare_import()  # idempotency keys are stable
    payment = next(c for c in first if c["operation"] == "invoice_payment")
    assert payment["evidence_only"] is True
    assert next(c for c in first if c["line_index"] == session.result.transactions[1].line_index)["corrected"]
    assert [e.action for e in session.events][-1] == "confirm"


def test_low_rows_cannot_be_rubber_stamped_and_failed_checks_need_a_note():
    result = extract_text_document(spans(INVOICE.replace("29/12 MULTA 2,00\n", "") + "\n30/12 LOJA 10,00 20,00"))
    session = ReviewSession(result=result, uid="u", content_hash="h")
    low = next(i for i, r in enumerate(result.transactions) if r.confidence_level == ConfidenceLevel.LOW)
    with pytest.raises(ReviewError):
        session.accept(low, actor="u", at="t")
    session.reject(low, actor="u", at="t", reason="linha ilegível")
    for index in range(len(result.transactions)):
        if index != low:
            session.accept(index, actor="u", at="t")
    with pytest.raises(ReviewError, match="invoice_total"):
        session.confirm(actor="u", at="t")
    with pytest.raises(ReviewError):
        session.acknowledge_check("invoice_total", actor="u", at="t", note=" ")
    session.acknowledge_check("invoice_total", actor="u", at="t", note="conferi no app do banco")
    session.confirm(actor="u", at="t")
    assert all(c["line_index"] != result.transactions[low].line_index for c in session.prepare_import())


# ---------------------------------------------------------------- engine adapters


class _FakePaddleResult:
    def __init__(self):
        self.json = {"res": {
            "rec_texts": ["12/11/2026", "MERCADO EXEMPLO", "125,90 D"],
            "rec_scores": [0.99, 0.97, 0.93],
            "rec_boxes": [[10, 10, 90, 30], [100, 12, 300, 30], [400, 11, 480, 31]],
        }}


class _FakePaddle:
    def __init__(self, **options):
        self.options = options

    def predict(self, array):
        return [_FakePaddleResult()]


def test_paddle_adapter_maps_boxes_to_lines_without_network():
    pil = pytest.importorskip("PIL.Image")
    pytest.importorskip("numpy")
    engine = PaddleOCREngine(factory=_FakePaddle, model_dir="/models")
    page = engine.read_image(pil.new("RGB", (500, 100), 255), page=1)
    assert engine._ocr.options["text_recognition_model_dir"] == "/models/rec"
    assert engine._ocr.options["enable_mkldnn"] is False
    assert [s.text for s in page.spans] == ["12/11/2026 MERCADO EXEMPLO 125,90 D"]
    assert page.spans[0].confidence == 0.93
    row = parse_statement_span(page.spans[0], source_engine="paddleocr")
    assert (row.amount_cents.value, row.direction) == (12590, Direction.EXPENSE)


def test_paddle_is_unavailable_without_local_models(tmp_path):
    assert PaddleOCREngine(model_dir=str(tmp_path)).available() is False


def test_ocr_specks_between_columns_are_tolerated_only_for_ocr():
    line = TextSpan("05/10/2026 PIX ENVIADO JOAO | R$120,00 | R$ 1.861,50 o")
    assert split_line(line) is None
    parts = split_line(line, repair_dates=True)
    assert [t.raw for t in parts.amounts] == ["R$120,00", "R$ 1.861,50"]
    assert parts.description == "PIX ENVIADO JOAO"


# ---------------------------------------------------------------- OCR worker


class _CannedEngine:
    name = "canned"

    def available(self):
        return True

    def read_image(self, image, *, page):
        from finnos.document_intelligence.engines import PageText

        lines = ["Extrato da conta corrente", "Período: 01/10/2026 a 31/10/2026",
                 "01/10/2026 SALDO ANTERIOR 100,00 C", "02/10/2026 PIX RECEBIDO 50,00 C",
                 "31/10/2026 SALDO FINAL 150,00 C"]
        return PageText(page=page, spans=[TextSpan(text, page=page, confidence=0.97) for text in lines],
                        engine=self.name, mean_confidence=0.97, char_count=100)


def _png() -> bytes:
    pil = pytest.importorskip("PIL.Image")
    import io

    buffer = io.BytesIO()
    pil.new("L", (300, 120), 255).save(buffer, format="PNG")
    return buffer.getvalue()


def test_worker_requires_token_uid_and_consent_and_keeps_nothing():
    pytest.importorskip("fastapi")
    pytest.importorskip("numpy")
    from fastapi.testclient import TestClient

    from finnos.document_intelligence.worker import create_app

    registry = EngineRegistry()
    registry.register(_CannedEngine())
    client = TestClient(create_app(registry=registry, token="s3cret"))
    body = _png()
    assert client.post("/v1/process", content=body).status_code == 401
    headers = {"Authorization": "Bearer s3cret", "X-FDI-UID": "user-1"}
    assert client.post("/v1/process", content=body, headers=headers).status_code == 403
    ok = client.post("/v1/process", content=body, headers={**headers, "X-FDI-Consent": "ocr"})
    assert ok.status_code == 200
    payload = ok.json()
    assert payload["result"]["status"] == "pending_review"
    assert payload["result"]["transactions"][0]["amount_cents"]["value"] == 5000
    assert payload["route"][-1] == "ocr:canned"
    bad = client.post("/v1/process", content=b"MZ not a document", headers={**headers, "X-FDI-Consent": "ocr"})
    assert bad.status_code == 422
    assert client.get("/healthz").json()["engines"] == ["canned"]
