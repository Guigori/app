"""Firebase-authenticated Firestore resource endpoints; migration-only."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool
from lib.firebase import get_firestore
from lib.firebase_auth import require_verified_firebase_user
from models.finnos import AccountIn, CategoryIn

router = APIRouter(prefix="/firebase/resources", tags=["firebase-resources"])
MODELS = {"accounts": AccountIn, "categories": CategoryIn}

def collection(uid, kind):
    if kind not in MODELS:
        raise HTTPException(status_code=404, detail="Unknown resource")
    return get_firestore().collection("users").document(uid).collection(kind)

@router.get("/{kind}")
async def list_resources(kind: str, user: dict = Depends(require_verified_firebase_user)):
    ref = collection(user["uid"], kind)
    return await run_in_threadpool(lambda: [s.to_dict() for s in ref.limit(500).stream()])

@router.post("/{kind}", status_code=201)
async def create_resource(kind: str, payload: dict, user: dict = Depends(require_verified_firebase_user)):
    ref = collection(user["uid"], kind)
    validated = MODELS[kind](**payload)
    now = datetime.now(timezone.utc)
    doc = validated.model_dump() | {"id": str(uuid.uuid4()), "created_at": now, "updated_at": now}
    await run_in_threadpool(lambda: ref.document(doc["id"]).create(doc))
    return doc
