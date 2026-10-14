# Third-party notices — FINNOS / FIINT

This file tracks **source code or assets actually incorporated** into FINNOS, not inspiration alone.

## Incorporated third-party source code

**None in the FIINT registration changes as of 2026-10-14.** The current parser, category memory and API adapters were authored specifically for FINNOS. No GitHub project code was copied into these modules.

## Research references (not incorporated)

- [dateparser](https://github.com/scrapinghub/dateparser) — natural-language date interpretation; reference only.
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) — OCR architecture; reference only.
- [Whisper](https://github.com/openai/whisper) — speech transcription architecture; reference only.

A link above is **not** a statement that FINNOS includes, depends on or complies with that project's license. Verify the exact upstream version, license, transitive dependencies and security before incorporating any code.

## Required procedure for future incorporation

1. Verify the precise upstream repository, source file, version/commit and SPDX license; do not copy from an unlicensed repository.
2. Confirm license compatibility with FINNOS distribution, including NOTICE, attribution, copyright, copyleft and patent obligations.
3. Preserve mandatory upstream headers and license texts. Add an entry here naming files and modifications.
4. Pin and audit dependencies; inspect supply-chain and data-processing risks.
5. Test functional parity, error handling, privacy boundaries and regressions.
6. Obtain explicit approval before deploying third-party code that transmits user financial data to an external service.

Suggested source header for **actually adapted** files:

```text
Upstream: <repository URL and exact commit>
Original file: <path>
Copyright: <original notice>
License: <SPDX identifier>
FINNOS modifications: <summary>
See THIRD_PARTY_NOTICES.md
```

Do not add a fabricated attribution header to independently authored code.
