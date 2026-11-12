"""Provider-neutral domain contracts for document extraction.

These models intentionally contain no OCR, cloud, Firebase, or AI-provider
dependency. Money is always integer cents. Every extracted value keeps the raw
text, the engine that read it and the evidence it came from.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

SCHEMA_VERSION = "1.1"


class DocumentKind(str, Enum):
    UNKNOWN = "unknown"
    BANK_STATEMENT = "bank_statement"
    CREDIT_CARD_STATEMENT = "credit_card_statement"
    PAYMENT_RECEIPT = "payment_receipt"
    FISCAL_DOCUMENT = "fiscal_document"
    PURCHASE_RECEIPT = "purchase_receipt"


class Direction(str, Enum):
    """Effect on the document holder: money in (credit) or out (debit)."""

    INCOME = "income"
    EXPENSE = "expense"
    UNKNOWN = "unknown"


class OperationKind(str, Enum):
    """What a line *is*. Reading a number well does not say which of these it is."""

    PURCHASE = "purchase"
    INSTALLMENT = "installment"
    INTEREST = "interest"
    LATE_FEE = "late_fee"  # multa
    LATE_INTEREST = "late_interest"  # juros de mora
    IOF = "iof"
    CHARGES = "charges"  # encargos (rotativo, financiamento)
    ANNUAL_FEE = "annual_fee"
    BANK_FEE = "bank_fee"
    CASH_WITHDRAWAL = "cash_withdrawal"
    INVOICE_PAYMENT = "invoice_payment"
    REFUND = "refund"  # estorno
    CREDIT = "credit"  # crédito/ajuste a favor
    PREVIOUS_BALANCE = "previous_balance"
    PIX_IN = "pix_in"
    PIX_OUT = "pix_out"
    TRANSFER_IN = "transfer_in"
    TRANSFER_OUT = "transfer_out"
    DEPOSIT = "deposit"
    SALARY = "salary"
    BILL_PAYMENT = "bill_payment"
    CARD_BILL_PAYMENT = "card_bill_payment"
    UNKNOWN = "unknown"


class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ReviewStatus(str, Enum):
    PENDING_REVIEW = "pending_review"
    NEEDS_CORRECTION = "needs_correction"
    REVIEWED = "reviewed"  # person confirmed; still nothing written anywhere
    REJECTED = "rejected"


class ValidationStatus(str, Enum):
    NOT_VALIDATED = "not_validated"
    VALID = "valid"
    INVALID = "invalid"
    AMBIGUOUS = "ambiguous"
    CORRECTED = "corrected"


BoundingBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class Evidence:
    """Trace to the exact source fragment.

    ``bounding_box`` is (x0, top, x1, bottom) normalised to 0..1 of the page,
    so it means the same for PDF points and image pixels.
    """

    page: int
    text: str
    bounding_box: BoundingBox | None = None

    def __post_init__(self) -> None:
        if self.page < 1:
            raise ValueError("evidence page must be >= 1")
        if self.bounding_box is not None:
            x0, top, x1, bottom = self.bounding_box
            if not (0.0 <= x0 <= x1 <= 1.0 and 0.0 <= top <= bottom <= 1.0):
                raise ValueError("bounding box must be normalised (x0<=x1, top<=bottom, 0..1)")

    def to_dict(self) -> dict[str, Any]:
        return {"page": self.page, "text": self.text, "bounding_box": self.bounding_box}


@dataclass(frozen=True)
class Correction:
    """A human correction. The original reading is never overwritten."""

    original_value: Any
    corrected_value: Any
    actor: str
    at: str  # ISO-8601 timestamp
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "original_value": self.original_value,
            "corrected_value": self.corrected_value,
            "actor": self.actor,
            "at": self.at,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class ExtractedField:
    value: Any
    raw_value: str
    confidence: float
    source_engine: str
    evidence: Evidence
    validation_status: str = ValidationStatus.NOT_VALIDATED.value
    correction: Correction | None = None

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")

    @property
    def effective_value(self) -> Any:
        return self.correction.corrected_value if self.correction else self.value

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "raw_value": self.raw_value,
            "confidence": self.confidence,
            "source_engine": self.source_engine,
            "evidence": self.evidence.to_dict(),
            "validation_status": self.validation_status,
            "correction": self.correction.to_dict() if self.correction else None,
        }


@dataclass(frozen=True)
class TextSpan:
    """One line of recognised text with provenance.

    ``confidence`` is the reader's own confidence (1.0 for native PDF text).
    ``words`` optionally keeps per-word boxes so columns can be told apart.
    """

    text: str
    page: int = 1
    bounding_box: BoundingBox | None = None
    confidence: float = 1.0
    words: tuple["Word", ...] = ()

    def __post_init__(self) -> None:
        if self.page < 1:
            raise ValueError("page must be >= 1")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")


@dataclass(frozen=True)
class Word:
    text: str
    x0: float
    top: float
    x1: float
    bottom: float
    confidence: float = 1.0


@dataclass(frozen=True)
class Installment:
    current: int
    total: int

    def __post_init__(self) -> None:
        if not (1 <= self.current <= self.total <= 99):
            raise ValueError("installment must satisfy 1 <= current <= total <= 99")

    def to_dict(self) -> dict[str, int]:
        return {"current": self.current, "total": self.total}


@dataclass(frozen=True)
class Check:
    """A deterministic validation and its outcome, kept for the reviewer."""

    name: str
    passed: bool | None  # None = could not be evaluated
    detail: str = ""
    expected_cents: int | None = None
    found_cents: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "passed": self.passed,
            "detail": self.detail,
            "expected_cents": self.expected_cents,
            "found_cents": self.found_cents,
        }


@dataclass
class ExtractedTransaction:
    transaction_date: ExtractedField | None
    description: ExtractedField | None
    amount_cents: ExtractedField | None
    direction: Direction = Direction.UNKNOWN
    operation: OperationKind = OperationKind.UNKNOWN
    installment: Installment | None = None
    balance_cents: ExtractedField | None = None
    confidence: float = 0.0
    confidence_level: ConfidenceLevel = ConfidenceLevel.LOW
    review_status: ReviewStatus = ReviewStatus.PENDING_REVIEW
    warnings: list[str] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    line_index: int = 0

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")

    @property
    def signed_cents(self) -> int | None:
        """Positive = money out / charge; negative = money in / credit."""
        if self.amount_cents is None or self.amount_cents.effective_value is None:
            return None
        cents = int(self.amount_cents.effective_value)
        if self.direction == Direction.EXPENSE:
            return cents
        if self.direction == Direction.INCOME:
            return -cents
        return None

    def to_dict(self) -> dict[str, Any]:
        def f(item: ExtractedField | None) -> dict[str, Any] | None:
            return item.to_dict() if item else None

        return {
            "line_index": self.line_index,
            "date": f(self.transaction_date),
            "description": f(self.description),
            "amount_cents": f(self.amount_cents),
            "balance_cents": f(self.balance_cents),
            "direction": self.direction.value,
            "operation": self.operation.value,
            "installment": self.installment.to_dict() if self.installment else None,
            "confidence": self.confidence,
            "confidence_level": self.confidence_level.value,
            "review_status": self.review_status.value,
            "warnings": list(self.warnings),
            "checks": [c.to_dict() for c in self.checks],
        }


@dataclass
class ExtractionResult:
    document_id: str
    document_kind: DocumentKind
    source_engine: str
    transactions: list[ExtractedTransaction] = field(default_factory=list)
    fields: dict[str, ExtractedField] = field(default_factory=dict)
    checks: list[Check] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    status: ReviewStatus = ReviewStatus.PENDING_REVIEW
    schema_version: str = SCHEMA_VERSION
    pages: int = 0
    engines_used: list[str] = field(default_factory=list)
    # Document-specific detail kept for review (e.g. receipt items and payments).
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-compatible output without losing field provenance."""
        return {
            "schema_version": self.schema_version,
            "document_id": self.document_id,
            "document_kind": self.document_kind.value,
            "source_engine": self.source_engine,
            "engines_used": list(self.engines_used),
            "pages": self.pages,
            "status": self.status.value,
            "warnings": list(self.warnings),
            "fields": {key: value.to_dict() for key, value in self.fields.items()},
            "checks": [c.to_dict() for c in self.checks],
            "transactions": [row.to_dict() for row in self.transactions],
            "details": self.details,
        }
