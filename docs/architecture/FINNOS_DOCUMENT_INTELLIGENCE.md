# FINNOS Document Intelligence (FDI)

**Status:** foundation / proof of concept  
**Execution target:** local-first + FINNOS-controlled server  
**Priority:** extraction precision  
**Default policy:** deterministic processing; external AI disabled

## Purpose

FDI converts financial documents into traceable, reviewable financial data. It is a document interpretation subsystem, not a second financial ledger.

The invariant is:

> FDI interprets; the user reviews; the existing FINNOS financial services persist.

FDI must not write directly to Firestore, transactions, cards, accounts, invoices, or the future Financial Ledger.

## Current repository boundaries

- Active API and financial routers: `frontend/api/index.py` and `frontend/finnos/`.
- Active persistence adapter: `frontend/finnos/lib/db.py`, UID-scoped Firestore.
- Legacy MongoDB backend is not an execution target.
- The initial FDI core is a pure Python module under `frontend/finnos/document_intelligence/`.
- No authentication, session, Firestore rules, financial router, or production entrypoint changes are part of this foundation.

## Architecture

1. **Ingestion (next phase):** validate file type, size, page count, and content; calculate a content hash; stage the original in temporary private storage.
2. **Text providers:** native PDF/text extraction and optional OCR engines return the provider-neutral `TextSpan` contract (page, text, optional bounding box).
3. **Classification:** identify document kind conservatively; unknown is safer than a false positive.
4. **Financial extraction:** provider-neutral deterministic parsers produce candidate fields and transaction rows.
5. **Validation:** validate dates, integer-cent amounts, direction, duplicate candidates, and document-level arithmetic.
6. **Review:** every result starts as `pending_review`; corrections retain original value, corrected value, actor, and timestamp.
7. **Import preparation:** after explicit confirmation, map candidates to existing FINNOS finance contracts. The integration must be idempotent and UID-scoped.

## Provider-neutral contracts

- `TextSpan`: recognized text, page number, optional normalized bounding box.
- `ExtractedField`: normalized value, raw value, confidence, source engine, evidence, validation status.
- `ExtractedTransaction`: candidate date, description, amount in integer cents, direction, confidence, warnings, review state.
- `ExtractionResult`: document identity, kind, engine, extracted fields/rows, warnings, schema version and review state.

Confidence is not a proof of correctness. OCR confidence, semantic confidence, and financial consistency must remain distinct. A high OCR score must not silently imply that a row is a purchase, Pix payment, transfer, refund, or invoice payment.

## Initial POC implementation

The first commit implements a text-first deterministic core:
- Brazilian currency normalization to integer cents.
- Explicit Brazilian date normalization.
- Conservative bank/card statement classification.
- Candidate transaction-row parsing from already recognized text.
- Per-field source evidence and engine provenance.
- Conservative direction handling: unsigned values remain unknown.
- An explicit OCR engine protocol and registry without heavyweight imports.
- Unit tests that do not require Firebase, Firestore, OCR packages, or external AI.

This is intentionally not yet a production upload API and does not claim to perform OCR. It creates the stable contract that PaddleOCR, Docling, Tesseract, native PDF extraction, and other providers can implement.

## Open-source provider strategy

| Provider | Intended role | Integration rule |
| --- | --- | --- |
| PaddleOCR | Primary OCR candidate | Optional server/local worker adapter; lazy dependency |
| Docling | Complex PDF/table parsing | Separate parser adapter |
| Tesseract | Comparison/fallback OCR | Optional adapter |
| OCRmyPDF | Scanned PDF preprocessing | Worker preprocessing stage |
| invoice2data | Template-driven invoice fields | Specialized adapter, not domain model |
| nfelib | Brazilian fiscal XML | Structured fiscal adapter |
| Bank Statement Parser | Evaluate supported bank formats | POC comparison only until validated |

Before adopting any provider, verify the exact release, transitive dependencies, model-weight licenses, runtime compatibility, memory/CPU profile, and behavior on the FINNOS reference corpus.

## Precision and safety rules

- Store money as integer cents in the FDI domain.
- Preserve raw text and evidence for every extracted field.
- Do not infer transaction direction when the document does not state it.
- Do not infer a successful Pix/payment from a screenshot or receipt.
- Never auto-create a financial transaction from OCR.
- Do not auto-merge possible duplicates; surface candidates for review.
- Keep OCR/provider imports out of API startup.
- Do not send documents to external AI providers by default.
- Never log raw document text or financial identifiers.
- Isolate document metadata, temporary files, jobs, and results by verified Firebase UID when persistence is introduced.

## POC gates

### FDI-01 — Text core (current foundation)
- [x] Provider-neutral extraction contracts
- [x] BRL cents and date normalization
- [x] Conservative statement row parser
- [x] Evidence and provenance
- [x] Unit tests
- [ ] Execute tests in repository CI and correct any failures

### FDI-02 — OCR and PDF adapters
- [ ] Native PDF text adapter
- [ ] PaddleOCR adapter behind optional dependency
- [ ] Tesseract comparison adapter
- [ ] Docling complex-document adapter
- [ ] Reference corpus with reviewed ground truth

### FDI-03 — Financial document extractors
- [ ] Bank statement layouts and balance reconciliation
- [ ] Card invoice cycle, installment, fee, refund, and payment extraction
- [ ] Receipt and fiscal XML extraction
- [ ] Pix receipt evidence extraction without payment authentication claims

### FDI-04 — Validation and review
- [ ] Field-level calibrated confidence
- [ ] Cross-engine disagreement handling
- [ ] Human correction history
- [ ] Duplicate candidate detection
- [ ] Review UI and explicit confirmation

### FDI-05 — Hybrid execution
- [ ] Local native-text and structured-format processing
- [ ] Optional local OCR runtime where supported
- [ ] FINNOS-controlled server workers for heavy OCR
- [ ] Explicit consent before uploading a document for server processing
- [ ] Resource limits, private staging, retention and deletion controls

### FDI-06 — Controlled financial integration
- [ ] Map reviewed candidates to existing financial service contracts
- [ ] UID-scoped idempotency key
- [ ] No direct Firestore writes from FDI
- [ ] Ledger and reconciliation integration only after user confirmation
- [ ] Audit and rollback tests

## Acceptance targets (to be measured, not assumed)

- Monetary amount exact match: at least 99%.
- Date exact match: at least 98%.
- Institution identification: at least 98%.
- Description exact/normalized match: at least 95%.
- Financial operation classification: at least 95%.
- Evidence traceability for every extracted critical field: 100%.

Report metrics separately by document type, source engine, and image quality. Compare monetary values in integer cents. Do not use an aggregate score to conceal errors in critical fields.

## Test commands

From the repository root:

```bash
PYTHONPATH=frontend python3 -m pytest -q frontend/finnos/tests/test_document_intelligence.py
PYTHONPATH=frontend python3 -m pytest -q frontend/finnos/tests
```

No live Firebase project or real user financial data is required for the deterministic core tests.
