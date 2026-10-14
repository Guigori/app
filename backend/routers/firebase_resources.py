"""Firebase-authenticated Firestore resource endpoints; migration-only."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool
from lib.firebase import get_firestore
from lib.firebase_auth import require_verified_firebase_user
from models.finnos import AccountIn, CategoryIn
from models.cards import CardIn

router = APIRouter(prefix="/firebase/resources", tags=["firebase-resources"])
MODELS = {"accounts": AccountIn, "categories": CategoryIn, "cards": CardIn}

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
    if kind == "cards" and validated.payment_account_id:
        account = await run_in_threadpool(lambda: collection(user["uid"], "accounts").document(validated.payment_account_id).get())
        if not account.exists:
            raise HTTPException(status_code=400, detail="Conta de pagamento inválida.")
    now = datetime.now(timezone.utc)
    doc = validated.model_dump() | {"id": str(uuid.uuid4()), "created_at": now, "updated_at": now}
    await run_in_threadpool(lambda: ref.document(doc["id"]).create(doc))
    return doc

@router.get("/{kind}/{identifier}")
async def get_resource(kind: str, identifier: str, user: dict = Depends(require_verified_firebase_user)):
    ref = collection(user["uid"], kind).document(identifier)
    snap = await run_in_threadpool(ref.get)
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Recurso não encontrado.")
    return snap.to_dict()

@router.put("/{kind}/{identifier}")
async def update_resource(kind: str, identifier: str, payload: dict, user: dict = Depends(require_verified_firebase_user)):
    validated = MODELS[kind](**payload)
    if kind == "cards" and validated.payment_account_id:
        account = await run_in_threadpool(lambda: collection(user["uid"], "accounts").document(validated.payment_account_id).get())
        if not account.exists:
            raise HTTPException(status_code=400, detail="Conta de pagamento inválida.")
    ref = collection(user["uid"], kind).document(identifier)
    def update():
        from google.api_core.exceptions import NotFound
        try:
            ref.update(validated.model_dump() | {"updated_at": datetime.now(timezone.utc)})
        except NotFound:
            return None
        return ref.get().to_dict()
    result = await run_in_threadpool(update)
    if result is None:
        raise HTTPException(status_code=404, detail="Recurso não encontrado.")
    return result

@router.delete("/{kind}/{identifier}", status_code=204)
async def delete_resource(kind: str, identifier: str, user: dict = Depends(require_verified_firebase_user)):
    ref = collection(user["uid"], kind).document(identifier)
    def remove():
        if not ref.get().exists:
            return "missing"
        root = get_firestore().collection("users").document(user["uid"])
        transactions = root.collection("transactions")
        fields = {
            "accounts": ("account_id", "to_account_id"),
            "categories": ("category_id",),
            "cards": ("card_id",),
        }
        for field in fields[kind]:
            if any(transactions.where(field, "==", identifier).limit(1).stream()):
                return "referenced"
        if kind == "accounts" and any(root.collection("cards").where("payment_account_id", "==", identifier).limit(1).stream()):
            return "referenced"
        ref.delete()
        return "deleted"
    outcome = await run_in_threadpool(remove)
    if outcome == "missing":
        raise HTTPException(status_code=404, detail="Recurso não encontrado.")
    if outcome == "referenced":
        raise HTTPException(status_code=409, detail="Existem registros vinculados.")
