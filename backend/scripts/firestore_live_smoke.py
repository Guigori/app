"""Opt-in live Firestore connectivity smoke test for FINNOS.

Run only with FIREBASE_LIVE_SMOKE=1 and valid Firebase Admin credentials.
Writes a random temporary document to an isolated diagnostic collection,
reads it, and removes it in finally. Does not touch users or transactions.
"""
import os
import uuid
from datetime import datetime, timezone

def main():
    if os.getenv("FIREBASE_LIVE_SMOKE") != "1":
        raise SystemExit("Refusing live writes: set FIREBASE_LIVE_SMOKE=1 explicitly.")
    expected = os.getenv("FIREBASE_PROJECT_ID", "")
    if expected != "finnos-app":
        raise SystemExit("Set FIREBASE_PROJECT_ID=finnos-app explicitly.")
    if not (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or
            (os.getenv("FIREBASE_CLIENT_EMAIL") and os.getenv("FIREBASE_PRIVATE_KEY")) or
            os.getenv("GOOGLE_APPLICATION_CREDENTIALS")):
        raise SystemExit("Firebase Admin credentials are required; no anonymous test.")
    from lib.firebase import get_firestore
    client = get_firestore()
    doc_id = "smoke-" + str(uuid.uuid4())
    ref = client.collection("_migration_smoke").document(doc_id)
    value = {"source": "finnos-migration", "created_at": datetime.now(timezone.utc),
             "nonce": doc_id}
    try:
        ref.create(value)
        result = ref.get()
        if not result.exists or result.to_dict().get("nonce") != doc_id:
            raise RuntimeError("Firestore write/read verification failed.")
        print("PASS: Firestore temporary write/read succeeded.")
    finally:
        ref.delete()
        print("Cleanup attempted: temporary document deleted.")

if __name__ == "__main__":
    main()
