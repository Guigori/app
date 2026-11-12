"""Document routing: validate the file, read text, decide when OCR is needed.

Execution targets:

* ``light`` — what the FINNOS API (a Vercel Python function) can run: file
  checks and the native PDF text layer. No OCR packages.
* ``ocr_worker`` — an isolated FINNOS-controlled worker with Tesseract and
  PaddleOCR baked in. It runs this same module; only the registry differs.

The light path never forwards a document to the worker by itself: when OCR is
needed it returns ``needs_ocr_worker`` and the person decides (consent).
On-device reading in the web app (pdf.js, structured files) produces the same
``TextSpan`` contract and can call :func:`extract_text_document` directly.
"""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass, field
from typing import Any

from finnos.document_intelligence.engines import (
    EngineRegistry,
    EngineUnavailableError,
    PageText,
    TesseractEngine,
    prepare_image,
    read_native_pdf,
    render_pdf_pages,
)
from finnos.document_intelligence.models import Check, ConfidenceLevel, ExtractionResult, TextSpan
from finnos.document_intelligence.parsers import confidence_level
from finnos.document_intelligence.service import extract_text_document


class DocumentRejected(ValueError):
    """The file is not something FDI will open (type, size, pages)."""


@dataclass(frozen=True)
class ProcessingPolicy:
    max_bytes: int = 15 * 1024 * 1024
    max_pages: int = 30
    max_image_pixels: int = 40_000_000
    min_native_chars_per_page: int = 40
    ocr_quality_threshold: float = 0.80
    compare_engines: bool = True
    render_dpi: int = 300
    ocr_consent: bool = False  # the person agreed to OCR on the FINNOS worker


@dataclass
class ProcessingOutcome:
    result: ExtractionResult | None
    content_hash: str
    file_type: str
    route: list[str] = field(default_factory=list)
    needs_ocr_worker: bool = False
    reason: str = ""
    page_quality: dict[int, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "content_hash": self.content_hash,
            "file_type": self.file_type,
            "route": list(self.route),
            "needs_ocr_worker": self.needs_ocr_worker,
            "reason": self.reason,
            "page_quality": dict(self.page_quality),
            "result": self.result.to_dict() if self.result else None,
        }


_MAGIC = (
    (b"%PDF-", "pdf"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpeg"),
)


def sniff_file_type(data: bytes) -> str:
    """Real type from the bytes, never from the file name."""
    head = data[:16]
    for magic, kind in _MAGIC:
        if head.startswith(magic):
            return kind
    if data[4:8] == b"ftyp" and data[8:12] in {b"heic", b"heix", b"mif1", b"heim", b"hevc"}:
        return "heic"
    raise DocumentRejected("unsupported_file_type")


def document_identity(uid: str, data: bytes) -> tuple[str, str]:
    """(content_hash, document_id). The id is scoped by uid: two people
    uploading the same file never share a document."""
    if not uid:
        raise ValueError("uid is required")
    content_hash = hashlib.sha256(data).hexdigest()
    document_id = "fdi_" + hashlib.sha256(f"{uid}:{content_hash}".encode()).hexdigest()[:40]
    return content_hash, document_id


def _open_image(data: bytes, file_type: str, policy: ProcessingPolicy) -> Any:
    from PIL import Image  # noqa: PLC0415

    if file_type == "heic":
        try:
            import pillow_heif  # noqa: PLC0415

            pillow_heif.register_heif_opener()
        except ImportError as exc:
            raise DocumentRejected("heic_requires_pillow_heif") from exc
    Image.MAX_IMAGE_PIXELS = policy.max_image_pixels
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:  # noqa: BLE001 - malformed images must not escape as 500s
        raise DocumentRejected("unreadable_image") from exc
    return image


def process_document(
    data: bytes,
    *,
    uid: str,
    registry: EngineRegistry | None = None,
    policy: ProcessingPolicy | None = None,
    target: str = "light",
) -> ProcessingOutcome:
    """Read one document and return review-only candidates. Never persists."""
    policy = policy or ProcessingPolicy()
    if len(data) == 0:
        raise DocumentRejected("empty_file")
    if len(data) > policy.max_bytes:
        raise DocumentRejected("file_too_large")
    file_type = sniff_file_type(data)
    content_hash, document_id = document_identity(uid, data)
    outcome = ProcessingOutcome(result=None, content_hash=content_hash, file_type=file_type)
    ocr_allowed = target == "ocr_worker"
    registry = registry if registry is not None else EngineRegistry()

    pages: list[PageText] = []
    needs_ocr: dict[int, Any] = {}

    if file_type == "pdf":
        from finnos.document_intelligence.engines import pdf_page_count  # noqa: PLC0415

        try:
            count = pdf_page_count(data)
        except Exception as exc:  # noqa: BLE001
            raise DocumentRejected("unreadable_pdf") from exc
        if count > policy.max_pages:
            raise DocumentRejected("too_many_pages")
        native = read_native_pdf(data, max_pages=policy.max_pages)
        outcome.route.append("native_pdf")
        for page in native:
            if page.char_count >= policy.min_native_chars_per_page:
                pages.append(page)
                outcome.page_quality[page.page] = 1.0
            else:
                needs_ocr[page.page] = None
    else:
        needs_ocr[1] = _open_image(data, file_type, policy)

    comparison: ExtractionResult | None = None
    if needs_ocr and not ocr_allowed:
        outcome.needs_ocr_worker = True
        outcome.reason = "scanned_or_image_document"
        outcome.route.append("stopped_before_ocr")
        if not pages:
            return outcome
    elif needs_ocr:
        if not policy.ocr_consent:
            raise DocumentRejected("ocr_requires_consent")
        if file_type == "pdf":
            needs_ocr.update(render_pdf_pages(data, sorted(needs_ocr), dpi=policy.render_dpi))
        ocr_pages, comparison = _run_ocr(needs_ocr, registry, policy, outcome)
        pages.extend(ocr_pages)

    pages.sort(key=lambda p: p.page)
    spans: list[TextSpan] = [span for page in pages for span in page.spans]
    engines = sorted({page.engine for page in pages})
    result = extract_text_document(spans, document_id=document_id, source_engine="+".join(engines) or "none")
    result.engines_used = engines
    result.pages = max([p.page for p in pages] + list(needs_ocr) or [0])
    if outcome.needs_ocr_worker:
        result.warnings.append("some_pages_need_ocr")
    low_pages = [n for n, q in outcome.page_quality.items() if q < policy.ocr_quality_threshold]
    if low_pages:
        result.warnings.append("low_ocr_quality_pages:" + ",".join(map(str, low_pages)))
        # A low page average (QR codes, status bars, stamps) does not override
        # values that closed a financial cross-check; everything else is capped.
        verified_document = any(c.passed for c in result.checks
                                if c.name in {"invoice_total", "statement_balance", "items_total", "payments_total"})
        for row in result.transactions:
            if verified_document or any(c.passed for c in row.checks if c.name == "running_balance"):
                continue
            if row.transaction_date and row.transaction_date.evidence.page in low_pages:
                row.confidence = min(row.confidence, 0.79)
                row.confidence_level = confidence_level(row.confidence)
    if comparison is not None:
        _apply_engine_comparison(result, comparison)
    outcome.result = result
    return outcome


def _run_ocr(images: dict[int, Any], registry: EngineRegistry, policy: ProcessingPolicy,
             outcome: ProcessingOutcome) -> tuple[list[PageText], ExtractionResult | None]:
    engines = registry.available()
    if not engines:
        raise EngineUnavailableError("no OCR engine available on this worker")
    # PaddleOCR first when its models are present; Tesseract otherwise.
    engines.sort(key=lambda e: 0 if e.name == "paddleocr" else 1)
    primary = engines[0]
    secondary = engines[1] if policy.compare_engines and len(engines) > 1 else None
    rotator = next((e for e in engines if isinstance(e, TesseractEngine)), None)

    primary_pages: list[PageText] = []
    secondary_pages: list[PageText] = []
    for number, image in sorted(images.items()):
        prepared = prepare_image(image)
        if rotator is not None:
            degrees = rotator.detect_rotation(prepared)
            if degrees:
                prepared = prepared.rotate(-degrees, expand=True)
                outcome.route.append(f"rotated_page_{number}_{degrees}")
        page = primary.read_image(prepared, page=number)
        primary_pages.append(page)
        outcome.page_quality[number] = page.mean_confidence
        if secondary is not None:
            secondary_pages.append(secondary.read_image(prepared, page=number))
    outcome.route.append(f"ocr:{primary.name}")
    comparison = None
    if secondary is not None:
        outcome.route.append(f"compare:{secondary.name}")
        spans = [span for page in secondary_pages for span in page.spans]
        comparison = extract_text_document(spans, source_engine=secondary.name)
    return primary_pages, comparison


def _row_key(row: Any) -> tuple | None:
    date_value = row.transaction_date.value if row.transaction_date else None
    amount = row.amount_cents.value if row.amount_cents else None
    if date_value is None or amount is None:
        return None
    return date_value, amount


def _apply_engine_comparison(result: ExtractionResult, other: ExtractionResult) -> None:
    """Rows the second engine also read (same date and cents) keep their score;
    the rest are capped at MEDIUM and flagged. Critical fields must agree."""
    other_keys: dict[tuple, int] = {}
    for row in other.transactions:
        key = _row_key(row)
        if key:
            other_keys[key] = other_keys.get(key, 0) + 1
    agreed = 0
    for row in result.transactions:
        key = _row_key(row)
        if key and other_keys.get(key):
            other_keys[key] -= 1
            agreed += 1
            continue
        row.warnings.append("engines_disagree")
        row.confidence = min(row.confidence, 0.85)
        row.confidence_level = confidence_level(row.confidence)
    total = len(result.transactions)
    result.engines_used = sorted(set(result.engines_used) | {other.source_engine})
    result.checks.append(Check("engine_agreement", None if total == 0 else agreed == total,
                               f"{agreed} de {total} linhas lidas igual por {other.source_engine}", total, agreed))
    if total and agreed < total:
        result.warnings.append("engines_disagree")


__all__ = [
    "ConfidenceLevel",
    "DocumentRejected",
    "ProcessingOutcome",
    "ProcessingPolicy",
    "document_identity",
    "process_document",
    "sniff_file_type",
]
