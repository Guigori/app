"""FCA endpoints — evidence-backed analyses for Radar, Análises and Finn."""
from fastapi import APIRouter,Depends,HTTPException,Query
from lib.db import db
from lib.fca import category_change_analyses
from models.fca import FCAAnalysis,FCAHomeOut
from routers.auth import require_user
router=APIRouter(prefix="/fca",tags=["fca"])
async def _build(user_id,limit=7):
    txs=await db.transactions.find({"user_id":user_id}).to_list(20000); cats=await db.categories.find({"user_id":user_id}).to_list(500)
    return category_change_analyses(txs,cats,limit)
@router.get("/analyses",response_model=FCAHomeOut)
async def analyses(limit:int=Query(default=7,ge=1,le=7),user:dict=Depends(require_user)):
    items=[FCAAnalysis(**x) for x in await _build(user["id"],limit)]; return FCAHomeOut(analyses=items,count=len(items))
@router.get("/analyses/{analysis_id}",response_model=FCAAnalysis)
async def detail(analysis_id:str,user:dict=Depends(require_user)):
    rows=await _build(user["id"],7); row=next((x for x in rows if x["id"]==analysis_id),None)
    if not row: raise HTTPException(status_code=404,detail="Análise não encontrada ou não é mais aplicável aos dados atuais.")
    return FCAAnalysis(**row)
