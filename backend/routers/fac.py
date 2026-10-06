from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from lib.db import db
from lib.fac.analysis import category_change_analyses
from lib.fac.clock import financial_today
from models.fac import FACAnalysis, FACHomeOut
from routers.auth import require_user

router=APIRouter(prefix="/fac",tags=["fac"])

async def _inputs(user_id: str, as_of: date):
    month_start=date(as_of.year,as_of.month,1);start=month_start-timedelta(days=90)
    q={"user_id":user_id,"date":{"$gte":start.isoformat(),"$lte":as_of.isoformat()},"status":"pago","$or":[{"type":"despesa"},{"transaction_role":{"$in":["refund","reversal"]}}]}
    txs=[]
    async for doc in db.transactions.find(q).sort([("date",1),("created_at",1)]):
        txs.append(doc)
    cats=await db.categories.find({"user_id":user_id}).to_list(500)
    return txs,cats

async def _build(user_id,as_of,limit):
    txs,cats=await _inputs(user_id,as_of)
    return category_change_analyses(txs,cats,as_of=as_of,limit=limit)

@router.get("/analyses",response_model=FACHomeOut)
async def analyses(limit:int=Query(default=7,ge=1,le=7),user:dict=Depends(require_user)):
    as_of=financial_today();items=[FACAnalysis(**x) for x in await _build(user["id"],as_of,limit)]
    return FACHomeOut(analyses=items,count=len(items))

@router.get("/analyses/{analysis_id}",response_model=FACAnalysis)
async def detail(analysis_id:str,user:dict=Depends(require_user)):
    as_of=financial_today();rows=await _build(user["id"],as_of,None)
    row=next((x for x in rows if x["analysis_id"]==analysis_id),None)
    if not row:raise HTTPException(404,"Análise não encontrada ou não é mais aplicável aos dados atuais.")
    return FACAnalysis(**row)
