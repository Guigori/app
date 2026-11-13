"""Human review of an extraction. The FDI interprets; the person validates.

A ``ReviewSession`` records every decision as an append-only event and never
overwrites what the engine read (corrections sit next to the original).
``prepare_import`` only *describes* what could be imported, with an
idempotency key per row; it does not call any FINNOS financial service.
"""
from __future__ import annotations

import dataclasses
import hashlib
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from finnos.document_intelligence.extractors import EVIDENCE_ONLY_OPERATIONS
from finnos.document_intelligence.models import (
    Check,
    ConfidenceLevel,
    Correction,
    Direction,
    ExtractedField,
    ExtractedTransaction,
    ExtractionResult,
    OperationKind,
    ReviewStatus,
    ValidationStatus,
)


class ReviewError(ValueError):
    pass


_EDITABLE = {"date": "transaction_date", "description": "description", "amount_cents": "amount_cents"}


@dataclass(frozen=True)
class ReviewEvent:
    seq: int
    action: str
    actor: str
    at: str
    target: str
    detail: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


@dataclass
class ReviewSession:
    result: ExtractionResult
    uid: str
    content_hash: str
    events: list[ReviewEvent] = field(default_factory=list)
    row_status: dict[int, ReviewStatus] = field(default_factory=dict)
    acknowledged_checks: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        if not self.uid:
            raise ReviewError("uid is required")
        for index in range(len(self.result.transactions)):
            self.row_status.setdefault(index, ReviewStatus.PENDING_REVIEW)

    # ------------------------------------------------------------ helpers
    def _log(self, action: str, actor: str, at: str, target: str, **detail: Any) -> None:
        if not actor or not at:
            raise ReviewError("actor and timestamp are required")
        self.events.append(ReviewEvent(len(self.events) + 1, action, actor, at, target, detail))

    def _row(self, index: int) -> ExtractedTransaction:
        if self.result.status == ReviewStatus.REVIEWED:
            raise ReviewError("document already confirmed")
        try:
            return self.result.transactions[index]
        except IndexError as exc:
            raise ReviewError("row not found") from exc

    # ------------------------------------------------------------ actions
    def correct(self, index: int, name: str, value: Any, *, actor: str, at: str, reason: str = "") -> None:
        row = self._row(index)
        if name in _EDITABLE:
            value = _validate_value(name, value)
            attr = _EDITABLE[name]
            current: ExtractedField | None = getattr(row, attr)
            if current is None:
                raise ReviewError("field has no reading to correct")
            correction = Correction(current.value, value, actor, at, reason)
            setattr(row, attr, dataclasses.replace(current, correction=correction,
                                                   validation_status=ValidationStatus.CORRECTED.value))
        elif name == "direction":
            original = row.direction.value
            row.direction = Direction(value)
            row.warnings.append(f"direction_corrected_from:{original}")
        elif name == "operation":
            original = row.operation.value
            row.operation = OperationKind(value)
            row.warnings.append(f"operation_corrected_from:{original}")
        else:
            raise ReviewError("field cannot be corrected")
        self.row_status[index] = ReviewStatus.REVIEWED
        self._log("correct", actor, at, f"row:{index}:{name}", value=value, reason=reason)

    def accept(self, index: int, *, actor: str, at: str) -> None:
        row = self._row(index)
        if row.confidence_level == ConfidenceLevel.LOW:
            raise ReviewError("low-confidence rows must be corrected or rejected, not just accepted")
        if row.direction == Direction.UNKNOWN or row.signed_cents is None:
            raise ReviewError("row needs amount and direction before it can be accepted")
        self.row_status[index] = ReviewStatus.REVIEWED
        self._log("accept", actor, at, f"row:{index}")

    def reject(self, index: int, *, actor: str, at: str, reason: str = "") -> None:
        self._row(index)
        self.row_status[index] = ReviewStatus.REJECTED
        self._log("reject", actor, at, f"row:{index}", reason=reason)

    def acknowledge_check(self, name: str, *, actor: str, at: str, note: str) -> None:
        if not note.strip():
            raise ReviewError("a failed check needs a note to be acknowledged")
        self.acknowledged_checks.add(name)
        self._log("acknowledge_check", actor, at, f"check:{name}", note=note)

    def recheck(self) -> list[Check]:
        """Re-run the document cross-check with the person's decisions:
        rejected rows out, corrected values in."""
        kept = [row for index, row in enumerate(self.result.transactions)
                if self.row_status.get(index) != ReviewStatus.REJECTED]
        signed = [row.signed_cents for row in kept]
        fields = self.result.fields
        checks: list[Check] = []
        if "total_cents" in fields and fields["total_cents"].effective_value is not None:
            total = int(fields["total_cents"].effective_value)
            if any(value is None for value in signed):
                checks.append(Check("invoice_total", None, "linhas sem valor ou direção", total, None))
            else:
                everything = sum(signed)
                new_only = sum(r.signed_cents for r in kept if r.operation not in EVIDENCE_ONLY_OPERATIONS)
                found = everything if everything == total else new_only
                checks.append(Check("invoice_total", total in (everything, new_only),
                                    "total da fatura com as decisões da revisão", total, found))
        if "opening_balance" in fields and "closing_balance" in fields:
            opening, closing = fields["opening_balance"].effective_value, fields["closing_balance"].effective_value
            if opening is not None and closing is not None and all(v is not None for v in signed):
                expected = int(opening) - sum(signed)
                checks.append(Check("statement_balance", expected == int(closing),
                                    "saldo com as decisões da revisão", expected, int(closing)))
        return checks

    def blocking_issues(self) -> list[str]:
        issues = []
        for index, status in sorted(self.row_status.items()):
            if status == ReviewStatus.PENDING_REVIEW:
                issues.append(f"row:{index}:pending")
            elif status == ReviewStatus.REVIEWED:
                row = self.result.transactions[index]
                if row.direction == Direction.UNKNOWN or row.signed_cents is None:
                    issues.append(f"row:{index}:incomplete")
        rechecked = {check.name: check for check in self.recheck()}
        original = {check.name: check for check in self.result.checks}
        for name in sorted(set(original) | set(rechecked)):
            current = rechecked.get(name, original.get(name))
            was_failed = original.get(name) is not None and original[name].passed is False
            if (current.passed is False or (current.passed is None and was_failed)) \
                    and name not in self.acknowledged_checks:
                issues.append(f"check:{name}:failed")
        return issues

    def confirm(self, *, actor: str, at: str) -> None:
        issues = self.blocking_issues()
        if issues:
            raise ReviewError("cannot confirm: " + ", ".join(issues))
        self.result.status = ReviewStatus.REVIEWED
        self._log("confirm", actor, at, "document")

    # ------------------------------------------------------------ output
    def prepare_import(self) -> list[dict[str, Any]]:
        """Describe reviewed rows for a later, explicit import step.

        Read-only: nothing is written. Rows that only evidence something
        already registered elsewhere (previous balance, invoice payment) are
        flagged ``evidence_only`` so the wallet matches instead of creating them.
        """
        if self.result.status != ReviewStatus.REVIEWED:
            raise ReviewError("document must be confirmed first")
        candidates = []
        for index, row in enumerate(self.result.transactions):
            if self.row_status.get(index) != ReviewStatus.REVIEWED:
                continue
            day = row.transaction_date.effective_value if row.transaction_date else None
            cents = row.amount_cents.effective_value if row.amount_cents else None
            key = hashlib.sha256(f"{self.uid}:{self.content_hash}:{index}:{day}:{cents}".encode()).hexdigest()
            candidates.append({
                "idempotency_key": key,
                "document_id": self.result.document_id,
                "line_index": row.line_index,
                "date": day,
                "description": row.description.effective_value if row.description else None,
                "amount_cents": cents,
                "direction": row.direction.value,
                "operation": row.operation.value,
                "installment": row.installment.to_dict() if row.installment else None,
                "evidence_only": row.operation in EVIDENCE_ONLY_OPERATIONS,
                "evidence": row.amount_cents.evidence.to_dict() if row.amount_cents else None,
                "corrected": any(
                    f is not None and f.correction is not None
                    for f in (row.transaction_date, row.description, row.amount_cents)
                ),
            })
        return candidates

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_id": self.result.document_id,
            "status": self.result.status.value,
            "rows": {str(k): v.value for k, v in sorted(self.row_status.items())},
            "acknowledged_checks": sorted(self.acknowledged_checks),
            "events": [e.to_dict() for e in self.events],
            "blocking_issues": self.blocking_issues(),
        }


def _validate_value(name: str, value: Any) -> Any:
    if name == "date":
        try:
            return date.fromisoformat(str(value)).isoformat()
        except ValueError as exc:
            raise ReviewError("date must be YYYY-MM-DD") from exc
    if name == "amount_cents":
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ReviewError("amount must be non-negative integer cents")
        return value
    if name == "description":
        text = " ".join(str(value).split())
        if not text or len(text) > 200:
            raise ReviewError("description must have 1-200 characters")
        return text
    raise ReviewError("unknown field")  # pragma: no cover
