"""Provider-neutral domain contracts for document extraction.

These models intentionally contain no OCR, cloud, Firebase, or AI-provider dependency.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class DocumentKind(str, Enum):
    UNKNOWN = "unknown"
    BANK_STATEMENT = "bank_statement"
    CREDIT_CARD_STATEMENT = "credit_card_statement"
    PAYMENT_RECEIPT = "payment_receipt"
    FISCAL_DOCUMENT = "fiscal_document"
    PURCHASE_RECEIPT = "purchase_receipt"


class Direction(str, Enum):
    INCOME = "income"
    EXPENSE = "expense"
    UNKNOWN = "unknown"


class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ReviewStatus(str, Enum):
    PENDING_REVIEW = "pending_review"
    NEEDS_CORRECTION = "needs_correction"
    REJECTED = "rejected"


@dataclass(frozen=True)
class Evidence:
    """Trace to the exact source fragment; coordinates are optional for text-only engines."""

    page: int
    text: str
    bounding_box: tuple[float, float, float, float] | None = None


@dataclass(frozen=True)
class ExtractedField:
    value: Any
    raw_value: str
    confidence: float
    source_engine: str
    evidence: Evidence
    validation_status: str = "not_validated"

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")
        if self.evidence.page < 1:
            raise ValueError("evidence page must be >= 1")


@dataclass(frozen=True)
class TextSpan:
    text: str
    page: int = 1
    bounding_box: tuple[float, float, float, float] | None = None

    def __post_init__(self) -> None:
        if self.page < 1:
            raise ValueError("page must be >= 1")


@dataclass
class ExtractedTransaction:
    transaction_date: ExtractedField | None
    description: ExtractedField | None
    amount_cents: ExtractedField | None
    direction: Direction = Direction.UNKNOWN
    confidence: float = 0.0
    confidence_level: ConfidenceLevel = ConfidenceLevel.LOW
    review_status: ReviewStatus = ReviewStatus.PENDING_REVIEW
    warnings: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")


@dataclass
class ExtractionResult:
    document_id: str
    document_kind: DocumentKind
    source_engine: str
    transactions: list[ExtractedTransaction] = field(default_factory=list)
    fields: dict[str, ExtractedField] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    status: ReviewStatus = ReviewStatus.PENDING_REVIEW
    schema_version: str = "1.0"

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-compatible output without losing field provenance."""
        def field_dict(item: ExtractedField | None) -> dict[str, Any] | None:
            if item is None:
                return None
            return {
                "value": item.value,
                "raw_value": item.raw_value,
                "confidence": item.confidence,
                "source_engine": item.source_engine,
                "evidence": {
                    "page": item.evidence.page,
                    "text": item.evidence.text,
                    "bounding_box": item.evidence.bounding_box,
                },
                "validation_status": item.validation_status,
            }

        return {
            "schema_version": self.schema_version,
            "document_id": self.document_id,
            "document_kind": self.document_kind.value,
            "source_engine": self.source_engine,
            "status": self.status.value,
            "warnings": list(self.warnings),
            "fields": {key: field_dict(value) for key, value in self.fields.items()},
            "transactions": [
                {
                    "date": field_dict(row.transaction_date),
                    "description": field_dict(row.description),
                    "amount_cents": field_dict(row.amount_cents),
                    "direction": row.direction.value,
                    "confidence": row.confidence,
                    "confidence_level": row.confidence_level.value,
                    "review_status": row.review_status.value,
                    "warnings": list(row.warnings),
                }
                for row in self.transactions
            ],
        }
