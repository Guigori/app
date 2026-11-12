"""End-to-end on the synthetic corpus: real PDFs (reportlab) read through the
native text layer, and — when Tesseract with Portuguese is installed — scanned
images through OCR. Thresholds are the POC gates, measured, not assumed."""
import shutil
import subprocess

import pytest

pytest.importorskip("pdfplumber")
pytest.importorskip("pypdfium2")
pytest.importorskip("reportlab")

from finnos.tests.fdi_benchmark import run  # noqa: E402


def _tesseract_por() -> bool:
    binary = shutil.which("tesseract")
    if not binary:
        return False
    out = subprocess.run([binary, "--list-langs"], capture_output=True, text=True).stdout.split()
    return "por" in out


def test_native_pdf_corpus_meets_poc_gates():
    metrics = run(["native_pdf"])["native_pdf"]["metrics"]
    assert metrics["amount_cents"]["rate"] >= 0.99
    assert metrics["date"]["rate"] >= 0.98
    assert metrics["institution"]["rate"] >= 0.98
    assert metrics["description"]["rate"] >= 0.95
    assert metrics["operation"]["rate"] >= 0.95
    assert metrics["evidence"]["rate"] == 1.0
    assert metrics["wrong_critical_shown_high"]["rate"] == 1.0


@pytest.mark.skipif(not _tesseract_por(), reason="tesseract with 'por' not installed")
def test_tesseract_scans_never_show_a_wrong_amount_as_high():
    pytest.importorskip("numpy")
    from finnos.document_intelligence.engines import EngineRegistry, TesseractEngine

    registry = EngineRegistry()
    registry.register(TesseractEngine())
    report = run(["clean", "scan"], ocr_registry=registry)
    assert report["clean"]["metrics"]["amount_cents"]["rate"] >= 0.95
    for variant in ("clean", "scan"):
        # Missing rows are allowed (the total/balance check flags them);
        # a wrong date/amount/direction presented as HIGH is not.
        assert report[variant]["metrics"]["wrong_critical_shown_high"]["rate"] == 1.0
