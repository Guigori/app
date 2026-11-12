"""Text readers: native PDF text, Tesseract and PaddleOCR.

Every reader returns ``PageText`` (lines as ``TextSpan`` with normalised
boxes). Heavy packages are imported lazily inside the adapters, so importing
this module never pulls OCR into the API process. Nothing here talks to an
external AI service; PaddleOCR runs with local model files only.
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from finnos.document_intelligence.layout import clamp_box, group_into_lines, merge_rows
from finnos.document_intelligence.models import TextSpan, Word


class EngineUnavailableError(RuntimeError):
    pass


@dataclass
class PageText:
    page: int
    spans: list[TextSpan]
    engine: str
    mean_confidence: float = 1.0
    char_count: int = 0
    warnings: list[str] = field(default_factory=list)


class OCREngine(Protocol):
    name: str

    def available(self) -> bool: ...

    def read_image(self, image: Any, *, page: int) -> PageText:
        """Read one PIL image and return its lines."""
        ...


class EngineRegistry:
    """Small explicit registry; avoids importing heavyweight OCR packages at API startup."""

    def __init__(self) -> None:
        self._engines: dict[str, OCREngine] = {}

    def register(self, engine: OCREngine) -> None:
        if not engine.name or engine.name in self._engines:
            raise ValueError("engine name must be unique and non-empty")
        self._engines[engine.name] = engine

    def get(self, name: str) -> OCREngine:
        try:
            return self._engines[name]
        except KeyError as exc:
            raise EngineUnavailableError(f"OCR engine '{name}' is not installed or registered") from exc

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._engines))

    def available(self) -> list[OCREngine]:
        return [engine for _, engine in sorted(self._engines.items()) if engine.available()]


def _summarise(page: int, spans: list[TextSpan], engine: str) -> PageText:
    chars = sum(len(s.text) for s in spans)
    mean = (sum(s.confidence * len(s.text) for s in spans) / chars) if chars else 0.0
    return PageText(page=page, spans=spans, engine=engine, mean_confidence=round(mean, 4), char_count=chars)


# ---------------------------------------------------------------- native PDF


def read_native_pdf(data: bytes, *, max_pages: int) -> list[PageText]:
    """Words with positions from the PDF text layer (pdfplumber/pdfminer)."""
    try:
        import pdfplumber  # noqa: PLC0415 - optional dependency
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise EngineUnavailableError("pdfplumber is not installed") from exc

    pages: list[PageText] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for number, page in enumerate(pdf.pages[:max_pages], start=1):
            width, height = float(page.width), float(page.height)
            words = []
            for w in page.extract_words(keep_blank_chars=False, use_text_flow=False, x_tolerance=1.5):
                box = clamp_box(w["x0"], w["top"], w["x1"], w["bottom"], width, height)
                words.append(Word(w["text"], *box, confidence=1.0))
            pages.append(_summarise(number, group_into_lines(words, page=number), "native_pdf"))
    return pages


def pdf_page_count(data: bytes) -> int:
    import pypdfium2 as pdfium  # noqa: PLC0415

    document = pdfium.PdfDocument(data)
    try:
        return len(document)
    finally:
        document.close()


def render_pdf_pages(data: bytes, pages: Sequence[int], *, dpi: int = 300) -> dict[int, Any]:
    """Render selected 1-based pages to PIL images (pypdfium2, Apache/BSD)."""
    try:
        import pypdfium2 as pdfium  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover
        raise EngineUnavailableError("pypdfium2 is not installed") from exc
    document = pdfium.PdfDocument(data)
    try:
        images = {}
        for number in pages:
            page = document[number - 1]
            images[number] = page.render(scale=dpi / 72).to_pil()
            page.close()
        return images
    finally:
        document.close()


# ---------------------------------------------------------------- image preparation


def estimate_skew(image: Any, *, max_angle: float = 4.0, step: float = 0.1) -> float:
    """Small-angle skew (degrees, counter-clockwise positive) by projection profile.

    Text rows give the sharpest horizontal ink profile when level, so the
    angle that maximises the variance of row sums is the skew.
    """
    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    small = image.convert("L")
    scale = 1000 / max(small.width, 1)
    if scale < 1:
        small = small.resize((int(small.width * scale), int(small.height * scale)))
    ink = (np.asarray(small) < 128).astype(np.uint8) * 255
    base = Image.fromarray(ink)
    best_angle, best_score = 0.0, -1.0
    angles = np.arange(-max_angle, max_angle + step / 2, step)
    for angle in angles:
        profile = np.asarray(base.rotate(float(angle), resample=Image.NEAREST)).sum(axis=1, dtype=np.float64)
        score = float(np.var(profile))
        if score > best_score:
            best_angle, best_score = float(angle), score
    return round(best_angle, 2)


def prepare_image(image: Any, *, min_width: int = 1800, deskew: bool = True) -> Any:
    """EXIF rotation, grayscale, contrast stretch, upscaling and deskew."""
    from PIL import Image, ImageOps  # noqa: PLC0415

    image = ImageOps.exif_transpose(image)
    image = image.convert("L")
    image = ImageOps.autocontrast(image, cutoff=1)
    if image.width < min_width:
        ratio = min_width / image.width
        image = image.resize((min_width, int(image.height * ratio)), Image.LANCZOS)
    if deskew:
        angle = estimate_skew(image)
        if abs(angle) >= 0.15:
            image = image.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=255)
    return image


# ---------------------------------------------------------------- Tesseract


class TesseractEngine:
    """Tesseract 5 through its CLI (Apache-2.0); no Python wrapper needed."""

    name = "tesseract"

    def __init__(self, *, binary: str | None = None, lang: str = "por", psm: int = 6, timeout: int = 120) -> None:
        self.binary = binary or os.environ.get("FDI_TESSERACT_BIN") or shutil.which("tesseract")
        self.lang = lang
        self.psm = psm
        self.timeout = timeout

    def available(self) -> bool:
        if not self.binary:
            return False
        try:
            langs = subprocess.run([self.binary, "--list-langs"], capture_output=True, text=True, timeout=20).stdout
        except (OSError, subprocess.SubprocessError):
            return False
        return all(lang in langs.split() for lang in self.lang.split("+"))

    def detect_rotation(self, image: Any) -> int:
        """Degrees to rotate clockwise according to Tesseract OSD (0 if unsure)."""
        if not self.binary:
            return 0
        with tempfile.TemporaryDirectory(prefix="fdi-") as tmp:
            path = os.path.join(tmp, "page.png")
            image.save(path)
            try:
                out = subprocess.run([self.binary, path, "stdout", "--psm", "0"], capture_output=True, text=True,
                                     timeout=self.timeout).stdout
            except (OSError, subprocess.SubprocessError):
                return 0
        rotate, confidence = 0, 0.0
        for line in out.splitlines():
            if line.startswith("Rotate:"):
                rotate = int(line.split(":")[1])
            if line.startswith("Orientation confidence:"):
                confidence = float(line.split(":")[1])
        return rotate if confidence >= 2.0 else 0

    def read_image(self, image: Any, *, page: int) -> PageText:
        if not self.binary:
            raise EngineUnavailableError("tesseract binary not found")
        with tempfile.TemporaryDirectory(prefix="fdi-") as tmp:  # removed right after reading
            path = os.path.join(tmp, "page.png")
            image.save(path)
            result = subprocess.run(
                [self.binary, path, "stdout", "-l", self.lang, "--psm", str(self.psm), "-c",
                 "preserve_interword_spaces=1", "tsv"],
                capture_output=True, text=True, timeout=self.timeout,
            )
        if result.returncode != 0:
            raise EngineUnavailableError("tesseract failed")  # stderr may contain text: not logged
        width, height = image.size
        groups: dict[tuple[str, str, str], list[Word]] = {}
        for row in result.stdout.splitlines()[1:]:
            cols = row.split("\t")
            if len(cols) < 12 or cols[0] != "5" or not cols[11].strip():
                continue
            left, top, w, h, conf = int(cols[6]), int(cols[7]), int(cols[8]), int(cols[9]), float(cols[10])
            box = clamp_box(left, top, left + w, top + h, width, height)
            groups.setdefault((cols[2], cols[3], cols[4]), []).append(
                Word(cols[11], *box, confidence=max(0.0, min(1.0, conf / 100))))
        # Tesseract already fits baselines per line; keep its lines and only
        # merge pieces of the same visual row that it put in different blocks.
        spans = merge_rows([group_into_lines(ws, page=page, line_tolerance=10.0)[0] for ws in groups.values()], page=page)
        return _summarise(page, spans, self.name)


# ---------------------------------------------------------------- PaddleOCR


class PaddleOCREngine:
    """PaddleOCR 3.x (Apache-2.0) with local models only.

    Models must be present on disk (``FDI_PADDLE_MODEL_DIR`` with ``det`` and
    ``rec`` sub-folders, or PaddleX's default cache). The engine never
    downloads models at request time; the worker image bakes them in.
    """

    name = "paddleocr"

    def __init__(self, *, lang: str = "pt", model_dir: str | None = None, factory: Any = None) -> None:
        self.lang = lang
        self.model_dir = model_dir or os.environ.get("FDI_PADDLE_MODEL_DIR")
        self._factory = factory  # injectable for tests
        self._ocr: Any = None

    def available(self) -> bool:
        if self._factory is not None:
            return True
        try:
            import importlib.util  # noqa: PLC0415

            return importlib.util.find_spec("paddleocr") is not None and self._models_present()
        except (ImportError, ValueError):
            return False

    def _models_present(self) -> bool:
        if self.model_dir:
            return all(os.path.isdir(os.path.join(self.model_dir, part)) for part in ("det", "rec"))
        cache = os.path.expanduser("~/.paddlex/official_models")
        return os.path.isdir(cache) and bool(os.listdir(cache))

    def _engine(self) -> Any:
        if self._ocr is None:
            options: dict[str, Any] = {
                "use_doc_orientation_classify": False,
                "use_doc_unwarping": False,
                "use_textline_orientation": False,
                # Paddle 3.3 CPU + oneDNN fails on PP-OCRv6 graphs; plain CPU kernels work.
                "enable_mkldnn": False,
            }
            if self.model_dir:
                options["text_detection_model_dir"] = os.path.join(self.model_dir, "det")
                options["text_recognition_model_dir"] = os.path.join(self.model_dir, "rec")
            else:
                options["lang"] = self.lang
            if self._factory is not None:
                self._ocr = self._factory(**options)
            else:
                os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
                from paddleocr import PaddleOCR  # noqa: PLC0415 - optional, heavy

                self._ocr = PaddleOCR(**options)
        return self._ocr

    def read_image(self, image: Any, *, page: int) -> PageText:
        import numpy as np  # noqa: PLC0415

        array = np.array(image.convert("RGB"))
        width, height = image.size
        words: list[Word] = []
        for result in self._engine().predict(array):
            data = result.json["res"] if hasattr(result, "json") and "res" in getattr(result, "json", {}) else result
            texts = data.get("rec_texts", [])
            scores = data.get("rec_scores", [])
            boxes = data.get("rec_boxes")
            if boxes is None or len(boxes) == 0:
                # Older/other pipelines return polygons only: use their bounding box.
                boxes = [[min(p[0] for p in poly), min(p[1] for p in poly), max(p[0] for p in poly),
                          max(p[1] for p in poly)] for poly in data.get("rec_polys", [])]
            for text, score, box in zip(texts, scores, boxes, strict=False):
                x0, top, x1, bottom = (float(v) for v in list(box)[:4])
                words.append(Word(str(text), *clamp_box(x0, top, x1, bottom, width, height),
                                  confidence=max(0.0, min(1.0, float(score)))))
        return _summarise(page, group_into_lines(words, page=page), self.name)


def default_registry() -> EngineRegistry:
    registry = EngineRegistry()
    registry.register(PaddleOCREngine())
    registry.register(TesseractEngine())
    return registry
