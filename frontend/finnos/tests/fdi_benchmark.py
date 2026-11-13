"""Field-level precision of FDI on the synthetic corpus.

Run from frontend/:  python -m finnos.tests.fdi_benchmark [--ocr] [--out report.json]
Money is compared exactly in cents; nothing is averaged across fields.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field

from finnos.document_intelligence.models import ExtractionResult
from finnos.document_intelligence.normalization import fold
from finnos.tests.fdi_corpus import Doc, build_corpus, render_image, render_pdf

FIELDS = ("date", "description", "amount_cents", "direction", "operation", "installment")


@dataclass
class Score:
    total: int = 0
    correct: int = 0
    errors: list[str] = field(default_factory=list)

    def add(self, ok: bool, note: str) -> None:
        self.total += 1
        self.correct += int(ok)
        if not ok and len(self.errors) < 20:
            self.errors.append(note)

    @property
    def rate(self) -> float:
        return self.correct / self.total if self.total else 1.0


def _norm(text: str | None) -> str:
    return " ".join(fold(text or "").split())


def score_document(doc: Doc, result: ExtractionResult | None, scores: dict[str, Score]) -> dict:
    rows = list(result.transactions) if result else []
    used: set[int] = set()
    missing = 0
    for truth in doc.rows:
        match = None
        for index, row in enumerate(rows):
            if index in used:
                continue
            same_amount = row.amount_cents and row.amount_cents.value == truth.cents
            same_desc = row.description and _norm(row.description.value) == _norm(truth.description)
            if same_amount and (same_desc or (row.transaction_date and row.transaction_date.value == truth.date)):
                match = index
                break
        if match is None:
            for index, row in enumerate(rows):
                if index not in used and row.description and _norm(row.description.value) == _norm(truth.description):
                    match = index
                    break
        if match is None:
            missing += 1
            for name in FIELDS:
                scores[name].add(False, f"{doc.name}: missing row {truth.description}")
            continue
        used.add(match)
        row = rows[match]
        got = {
            "date": row.transaction_date.value if row.transaction_date else None,
            "description": _norm(row.description.value) if row.description else None,
            "amount_cents": row.amount_cents.value if row.amount_cents else None,
            "direction": row.direction.value,
            "operation": row.operation.value,
            "installment": (row.installment.current, row.installment.total) if row.installment else None,
        }
        want = {
            "date": truth.date, "description": _norm(truth.description), "amount_cents": truth.cents,
            "direction": truth.direction, "operation": truth.operation, "installment": truth.installment,
        }
        for name in FIELDS:
            scores[name].add(got[name] == want[name], f"{doc.name}: {name} {got[name]!r} != {want[name]!r}")
        critical_wrong = any(got[n] != want[n] for n in ("date", "amount_cents", "direction"))
        scores["wrong_critical_shown_high"].add(
            not (critical_wrong and row.confidence_level.value == "high"),
            f"{doc.name}: HIGH but wrong {truth.description}: {got}")
    extra = len(rows) - len(used)
    for index, row in enumerate(rows):
        if index not in used:
            scores["wrong_critical_shown_high"].add(row.confidence_level.value != "high",
                                                    f"{doc.name}: extra HIGH row {row.description.value if row.description else ''}")
    institution = result.fields.get("institution") if result else None
    scores["institution"].add(bool(institution and institution.value == doc.institution),
                              f"{doc.name}: institution {institution.value if institution else None}")
    scores["document_kind"].add(bool(result and result.document_kind.value == doc.kind), f"{doc.name}: kind")
    for name, value in doc.fields.items():
        key = {"opening_balance": "opening_balance", "closing_balance": "closing_balance"}.get(name, name)
        got_field = result.fields.get(key) if result else None
        scores["document_fields"].add(bool(got_field and got_field.value == value),
                                      f"{doc.name}: {name} {got_field.value if got_field else None!r} != {value!r}")
    evidence_ok = all(
        f is not None and f.evidence.text and f.evidence.page >= 1
        for row in rows for f in (row.transaction_date, row.amount_cents, row.description)
    )
    scores["evidence"].add(evidence_ok, f"{doc.name}: evidence")
    checks = {c.name: c.passed for c in (result.checks if result else [])}
    return {"document": doc.name, "rows": len(doc.rows), "missing": missing, "extra": extra, "checks": checks,
            "levels": [r.confidence_level.value for r in rows]}


def run(variants: list[str], *, ocr_registry=None) -> dict:
    from finnos.document_intelligence.processor import ProcessingPolicy, process_document

    report = {}
    for variant in variants:
        scores = {name: Score() for name in (*FIELDS, "institution", "document_kind", "document_fields", "evidence",
                                                    "wrong_critical_shown_high")}
        details = []
        started = time.perf_counter()
        for doc in build_corpus():
            pdf = render_pdf(doc)
            data = pdf if variant == "native_pdf" else render_image(pdf, variant=variant)
            target = "light" if variant == "native_pdf" else "ocr_worker"
            outcome = process_document(data, uid="bench-user", registry=ocr_registry, target=target,
                                       policy=ProcessingPolicy(ocr_consent=True))
            details.append({**score_document(doc, outcome.result, scores), "route": outcome.route})
        report[variant] = {
            "seconds": round(time.perf_counter() - started, 2),
            "documents": len(details),
            "metrics": {name: {"rate": round(s.rate, 4), "correct": s.correct, "total": s.total, "errors": s.errors}
                        for name, s in scores.items()},
            "details": details,
        }
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ocr", action="store_true", help="also run scanned and photo variants through OCR")
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    variants = ["native_pdf"]
    registry = None
    if args.ocr:
        from finnos.document_intelligence.engines import default_registry

        registry = default_registry()
        variants += ["clean", "scan", "photo"]
    report = run(variants, ocr_registry=registry)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text)
    for variant, data in report.items():
        line = ", ".join(f"{k} {v['rate']:.1%}" for k, v in data["metrics"].items())
        print(f"[{variant}] {data['seconds']}s  {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
