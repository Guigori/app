"""OCR adapter contracts; concrete providers are optional plugins, never domain dependencies."""
from collections.abc import Sequence
from typing import Protocol

from finnos.document_intelligence.models import TextSpan


class OCREngine(Protocol):
    name: str

    def extract_text(self, document_bytes: bytes, filename: str) -> Sequence[TextSpan]:
        """Return recognized text with page and optional bounding-box provenance."""
        ...


class EngineUnavailableError(RuntimeError):
    pass


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
