"""Preview-only Firestore diagnostic, never exposed in production.

Requires both a verified Firebase bearer token and explicit preview opt-in.
Writes a random diagnostic document, reads it, then deletes it.
No user financial data is accessed.
"""
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from lib.firebase import get_firestore
from lib.firebase_auth import require_verified_firebase_user

router = APIRouter(prefix="/firebase/diagnostics", tags=["firebase-diagnostics"])

@router.post("/firestore-smoke")
async def firestore_smoke(user: dict = Depends(require_verified_firebase_user)):
    if (os.getenv("VERCEL_ENV") != "preview"
            or os.getenv("FIREBASE_LIVE_SMOKE") != "1"):
        raise HTTPException(status_code=404, detail="Not found")

    def check():
        doc_id = "smoke-" + str(uuid.uuid4())
        ref = get_firestore().collection("_migration_smoke").document(doc_id)
        payload = {
            "source": "finnos-preview-diagnostic",
            "nonce": doc_id,
            "created_at": datetime.now(timezone.utc),
        }
        try:
            ref.create(payload)
            snapshot = ref.get()
            if not snapshot.exists or snapshot.to_dict().get("nonce") != doc_id:
                raise RuntimeError("Firestore read-back mismatch")
        finally:
            ref.delete()
        return {"status": "ok", "write": True, "read": True,
                "delete": True, "project": "finnos-app"}

    return await run_in_threadpool(check)
