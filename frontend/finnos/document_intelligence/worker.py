"""OCR worker: the server half of hybrid execution. NOT mounted in the FINNOS API.

It runs as its own service (see ``worker.Dockerfile``) with Tesseract and
PaddleOCR models baked in. The FINNOS API is its only client: it verifies the
person's Firebase session, asks for consent, and forwards the file with a
service token and the verified uid. The worker keeps nothing: the file lives in
memory for the request and the result goes back to the API for review.
"""
from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from finnos.document_intelligence.engines import EngineRegistry, EngineUnavailableError, default_registry
from finnos.document_intelligence.processor import DocumentRejected, ProcessingPolicy, process_document


def create_app(*, registry: EngineRegistry | None = None, token: str | None = None,
               policy: ProcessingPolicy | None = None) -> Any:
    secret = token if token is not None else os.environ.get("FDI_WORKER_TOKEN", "")
    engines = registry if registry is not None else default_registry()
    base_policy = policy or ProcessingPolicy()
    app = FastAPI(title="FINNOS FDI OCR worker", docs_url=None, redoc_url=None, openapi_url=None)

    def _authorize(request: Request) -> str:
        header = request.headers.get("authorization", "")
        if not secret or not header.startswith("Bearer ") or not hmac.compare_digest(header[7:], secret):
            raise HTTPException(status_code=401, detail="unauthorized")
        uid = request.headers.get("x-fdi-uid", "").strip()
        if not uid or len(uid) > 128:
            raise HTTPException(status_code=400, detail="uid_required")
        return uid

    @app.get("/healthz")
    def health() -> dict[str, Any]:
        return {"ok": True, "engines": [engine.name for engine in engines.available()]}

    @app.post("/v1/process")
    async def process(request: Request) -> dict[str, Any]:
        uid = _authorize(request)
        if request.headers.get("x-fdi-consent") != "ocr":
            raise HTTPException(status_code=403, detail="ocr_requires_consent")
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > base_policy.max_bytes:
            raise HTTPException(status_code=413, detail="file_too_large")
        data = await request.body()
        policy = ProcessingPolicy(**{**base_policy.__dict__, "ocr_consent": True})
        try:
            outcome = process_document(data, uid=uid, registry=engines, policy=policy, target="ocr_worker")
        except DocumentRejected as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        except EngineUnavailableError:
            raise HTTPException(status_code=503, detail="ocr_engine_unavailable") from None
        return outcome.to_dict()

    return app
