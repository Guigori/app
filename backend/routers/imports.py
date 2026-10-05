"""Financial import staging: parse -> review -> explicit confirm. No preview writes transactions."""

import re, uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from lib.db import db
from routers.auth import require_user

router=APIRouter(prefix="/imports",tags=["imports"])

class ImportRowIn(BaseModel):
    date:str=Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    description:str=Field(min_length=1,max_length=180)
    value:float=Field(gt=0)
    type:str=Field(pattern="^(receita|despesa)$")
    category_id:str|None=None
    selected:bool=True

class ImportConfirmIn(BaseModel):
    account_id:str
    card_id:str|None=None
    kind:str=Field(pattern="^(statement|invoice)$")
    filename:str|None=Field(default=None,max_length=180)
    rows:list[ImportRowIn]=Field(max_length=500)

@router.post("/confirm")
async def confirm_import(payload:ImportConfirmIn,user:dict=Depends(require_user)):
    account=await db.accounts.find_one({"id":payload.account_id,"user_id":user["id"]})
    if not account: raise HTTPException(400,"Conta inválida.")
    if payload.card_id and not await db.cards.find_one({"id":payload.card_id,"user_id":user["id"]):
        raise HTTPException(400,"Cartão inválido.")
    categories={c["id"] for c in await db.categories.find({"user_id":user["id"]}).to_list(500)}
    selected=[r for r in payload.rows if r.selected]
    now=datetime.now(timezone.utc)
    docs=[]
    for row in selected:
        if row.category_id and row.category_id not in categories: raise HTTPException(400,"Categoria inválida na revisão.")
        docs.append({"id":str(uuid.uuid4()),"user_id":user["id"],"name":row.description.strip(),"value":round(row.value,2),"type":"despesa" if payload.kind=="invoice" else row.type,"status":"pago","date":row.date,"account_id":payload.account_id,"card_id":payload.card_id if payload.kind=="invoice" else None,"to_account_id":None,"category_id":row.category_id,"fixed":False,"recurrence":None,"installment":False,"total_installments":None,"current_installment":None,"installment_value":None,"adjusted_value":None,"attachment":payload.filename,"notes":"Importado após revisão e confirmação do usuário.","import_id":None,"created_at":now,"updated_at":now})
    import_id=str(uuid.uuid4())
    for doc in docs: doc["import_id"]=import_id
    if docs: await db.transactions.insert_many(docs)
    await db.financial_imports.insert_one({"id":import_id,"user_id":user["id"],"kind":payload.kind,"filename":payload.filename,"account_id":payload.account_id,"card_id":payload.card_id,"count":len(docs),"created_at":now})
    return {"ok":True,"import_id":import_id,"count":len(docs)}
