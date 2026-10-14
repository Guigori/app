from fastapi import HTTPException
from lib.firebase import get_firestore

def validate(uid, payload):
    root = get_firestore().collection("users").document(uid)
    def owned(group, value):
        return root.collection(group).document(value).get().exists
    if not owned("accounts", payload.account_id):
        raise HTTPException(400, "Conta inválida")
    if payload.type == "transferencia":
        if not payload.to_account_id or payload.to_account_id == payload.account_id:
            raise HTTPException(400, "Transferência exige contas distintas")
    if payload.to_account_id and not owned("accounts", payload.to_account_id):
        raise HTTPException(400, "Conta de destino inválida")
    if payload.category_id and not owned("categories", payload.category_id):
        raise HTTPException(400, "Categoria inválida")
    if payload.card_id and not owned("cards", payload.card_id):
        raise HTTPException(400, "Cartão inválido")
    if payload.card_id and payload.type != "despesa":
        raise HTTPException(400, "Cartão somente para despesas")
