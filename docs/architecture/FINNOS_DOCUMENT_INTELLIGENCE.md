# FINNOS Document Intelligence (FDI)

**Status:** POC engine on branch `feat/fdi-engine` (on top of `feat/fdi-foundation`). Not deployed, not merged.
**Execution:** light path inside the API + isolated OCR worker (not deployed).
**Priority:** extraction precision.
**Default policy:** deterministic processing; external AI never used.

> FDI interprets; the person reviews; the existing FINNOS financial services persist.

FDI does not import, call or write to Firestore, `finnos.lib.db`, routers, the
wallet or any Ledger. A test enforces that the package imports none of them.

## Audit of the foundation (PR #123)

The foundation had the right shape (pure module, provider-neutral contracts,
cents, no heavy imports) but these defects were confirmed by test and fixed:

| # | Defect | Fix |
| --- | --- | --- |
| 1 | `PIX 100,00 5.000,00` → amount = balance column, description swallowed the amount | Trailing amount group + column layout (header words and x positions). Without layout: amount left empty, `multiple_amount_columns`, LOW |
| 2 | `1234.567` → R$ 1.234.567,00 | Dot-thousands only with valid grouping; cents need exactly 2 digits |
| 3 | `125,90-` (Itaú/BB) rejected | Trailing minus and `(125,90)` accepted, sign source kept |
| 4 | `R$ -125,90` → "R$" in the description | Currency and sign are part of the token |
| 5 | Card rows without year (`12/11`, `12 NOV`) never parsed | Year inferred against the due/closing date |
| 6 | `-50,00 C` silently EXPENSE | Conflict → direction UNKNOWN, `sign_marker_conflict`, LOW |
| 7 | "consumidor"/"valor total" classified as receipt | A kind needs a strong phrase |
| 8 | Fixed confidences, averaged | Row confidence = weakest component; HIGH needs a cross-check |
| 9 | Document id = hash of extracted text | uid-scoped id over the file bytes |
| 10 | Empty-string sign check | Fixed; `""`/`"R$"` fail closed |

## Pipeline

```
bytes ─► sniff type (magic bytes) ─► limits (size, pages, pixels)
      ─► PDF text layer (pdfplumber, word boxes) ── page has text? ─► lines
                                           └─ no ─► light target: stop, needs_ocr_worker
                                                    worker + consent: render (pypdfium2 300 dpi)
images ─► EXIF/grayscale/contrast/upscale/deskew ─► OSD rotation ─► PaddleOCR | Tesseract
      ─► lines (TextSpan + words + boxes + confidence)
      ─► classify kind ─► identify issuer ─► statement | invoice extractor
      ─► checks (running balance, statement balance, invoice total, engine agreement)
      ─► ExtractionResult (pending_review) ─► ReviewSession ─► prepare_import (read-only)
```

Modules (`frontend/finnos/document_intelligence/`):

| Module | Role |
| --- | --- |
| `models.py` | Contracts: `TextSpan`/`Word`, `ExtractedField` (value, raw, confidence, engine, evidence, validation, correction), `ExtractedTransaction` (+ operation, installment, balance, checks), `ExtractionResult` |
| `normalization.py` | BRL amounts with sign source, pt-BR dates, `12 NOV`, year inference |
| `parsers.py` | Line splitting, OCR noise tolerance, operation classification, field confidence |
| `extractors.py` | Bank statement and card invoice extractors, checks, confidence caps |
| `institutions.py` | Inter, Itaú, Bradesco, Nubank, Banco do Brasil by CNPJ / legal name / brand, header+footer only |
| `layout.py` | Words/boxes → lines; same-row merging |
| `engines.py` | Native PDF reader, PDF renderer, image preparation + deskew, `TesseractEngine` (CLI, TSV), `PaddleOCREngine` (local models only), registry |
| `processor.py` | Routing, limits, consent gate, engine comparison |
| `review.py` | Corrections (original kept), accept/reject, check acknowledgement, re-check with decisions, append-only events, `prepare_import` with idempotency keys |
| `worker.py` | OCR worker app (token + verified uid + consent). Not mounted in the API |

Operations recognised on invoices: purchase, installment (`PARC 03/10`,
`03 DE 10`, `Parcela 3/10`, `(Parcela 3 de 10)`), interest, late interest
(juros de mora), late fee (multa), IOF, charges (encargos/rotativo), annual
fee, bank fee, cash withdrawal, invoice payment, refund (estorno), credit
(cashback/ajuste), previous balance. Foreign-currency columns are skipped in
favour of the BRL amount. Previous balance and invoice payment are
`evidence_only` in `prepare_import`: the wallet should match them, not create them.

On statements: Pix in/out, TED/DOC in/out, salary, deposit, bill payment,
card bill payment, purchase, fee, withdrawal, IOF, interest, refund.

## Confidence

| Level | Score | Meaning |
| --- | --- | --- |
| HIGH | ≥ 0.95 | Clean reading **and** a financial cross-check passed (row running balance or document total/balance) |
| MEDIUM | 0.80–0.94 | Highlighted for review (inferred columns, OCR-repaired date, direction from description, not cross-checked, engines disagree, document total failed) |
| LOW | < 0.80 | Must be corrected or rejected; cannot be accepted as is |

Score = minimum of date, amount, description, direction and semantic
components. Thresholds are hypotheses to calibrate.

## Hybrid execution

* **Light (API):** type sniffing, limits, PDF text layer. No OCR packages, so
  `frontend/requirements.txt` is unchanged. Scanned pages → `needs_ocr_worker`.
* **OCR worker:** separate service (`worker.Dockerfile`, `requirements-ocr.txt`)
  with Tesseract `por` and PaddleOCR models baked in. Requires a service token,
  the uid the API verified, and `X-FDI-Consent: ocr`. Nothing is stored.
* **On device (later):** pdf.js / structured files in the web app produce the
  same `TextSpan` contract.

PaddlePaddle alone is a 193 MB wheel; it cannot live in the Vercel function.

## Results on the synthetic corpus (10 documents, 98 rows, 5 banks)

Measured with `python -m finnos.tests.fdi_benchmark --ocr` (Tesseract 5.3.4 por):

| Variant | Amount | Date | Description | Operation | Wrong value shown HIGH | Missing rows |
| --- | --- | --- | --- | --- | --- | --- |
| Native PDF | 100% | 100% | 100% | 100% | 0 | 0 |
| Clean image, Tesseract | 100% | 100% | 100% | 100% | 0 | 0 |
| Scan (blur, noise, 1.2° skew) | 94.9% | 94.9% | 79.6% | 93.9% | 0 | 5 (all in docs whose total/balance check failed) |
| Phone photo (90° + JPEG) | 84.7% | 84.7% | 80.6% | 84.7% | 0 | 15 (same) |

Read these honestly: the corpus is generated by the same team that wrote the
parsers, so native-PDF 100% says the parsers handle *these* layouts, not real
bank PDFs. The meaningful signals are (a) zero wrong date/amount/direction
shown as HIGH, and (b) every document with a missing row failed its
cross-check. **PaddleOCR was not measured here** (model hosts unreachable from
the dev sandbox); the `fdi-lab` workflow measures it on GitHub.

## POC gates

- [x] FDI-01 core contracts, normalisation, evidence (audit fixes above)
- [x] FDI-02 native PDF adapter, Tesseract adapter, PaddleOCR adapter (fake-tested), engine comparison
- [ ] FDI-02 Docling adapter (not needed by current layouts; add when a table layout requires it)
- [x] FDI-03 statements (running balance, D/C, debit/credit columns) and card invoices (full set of operations)
- [ ] FDI-03 receipts, fiscal XML (nfelib), Pix receipts
- [x] FDI-04 field confidence, review with corrections/history, duplicate flags, re-check
- [ ] FDI-04 review UI
- [x] FDI-05 light/worker routing, consent gate, limits, worker app
- [ ] FDI-05 worker deploy, private staging, retention
- [ ] FDI-06 integration with wallet/Ledger (explicitly out of scope until authorised)
- [ ] Corpus of **real anonymised** documents from the five banks with reviewed ground truth

## Test commands

```bash
cd frontend
PYTHONPATH=. python -m pytest -q finnos/tests/test_document_intelligence.py finnos/tests/test_fdi_engine.py finnos/tests/test_fdi_corpus.py
PYTHONPATH=. python -m finnos.tests.fdi_benchmark --ocr --out fdi-report.json
```

PDF/OCR tests skip when pdfplumber, reportlab or Tesseract `por` are missing,
so the existing API CI keeps its current dependencies.
