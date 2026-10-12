"""UID-scoped goal plans. Saving a plan never moves bank money."""
import uuid
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import Field, model_validator
from finnos.lib.money import FinanceModel, Money, D, cents
from finnos.lib.db import db
from finnos.lib.dates import today_iso
from finnos.lib.stats import month_portion, add_months
from finnos.routers.auth import require_user

router = APIRouter(prefix='/goals',tags=['goals'])

class GoalIn(FinanceModel):
    name: str = Field(min_length=1,max_length=100)
    category: str = Field(max_length=100)
    mode: Literal['tradicional','inteligente']
    target: Money = Field(gt=0)
    saved: Money = Field(default=0,ge=0)
    months: int = Field(ge=1,le=1200)
    contribution: Money = Field(ge=0)
    frequency: Literal['Mensal','Quinzenal','Semanal']
    account: str
    strategy: str | None = Field(None,max_length=50)
    remind: bool = True
    radar: bool = True

    @model_validator(mode='after')
    def valid_saved(self):
        if self.saved > self.target: raise ValueError('Reserva excede objetivo.')
        return self

class GoalOut(GoalIn):
    id: str
    createdAt: str

@router.get('',response_model=list[GoalOut])
async def list_goals(user=Depends(require_user)):
    return [GoalOut(**{k:v for k,v in row.items() if k not in {'user_id','updated_at'}}) for row in await db.goals.find({'user_id':user['id']}).to_list(500)]

@router.post('',response_model=GoalOut,status_code=201)
async def create_goal(payload:GoalIn,user=Depends(require_user)):
    doc=dict(payload.model_dump(),id=str(uuid.uuid4()),user_id=user['id'],createdAt=datetime.now(timezone.utc).isoformat())
    await db.goals.insert_one(doc)
    return GoalOut(**{k:v for k,v in doc.items() if k!='user_id'})

@router.get('/suggestion')
async def suggestion(user=Depends(require_user)):
    txs=await db.transactions.find({'user_id':user['id']}).to_list(20000)
    goals=await db.goals.find({'user_id':user['id']}).to_list(500)
    current=today_iso()[:7]
    months=[add_months(current,-i) for i in range(3)]
    observed=[m for m in months if any(month_portion(t,m) is not None for t in txs)]
    income=expense=0
    for month in observed:
        for tx in txs:
            amount=month_portion(tx,month)
            if amount is None: continue
            if tx['type']=='receita':income+=cents(amount)
            elif tx['type']=='despesa':expense+=cents(amount)
    n=max(len(observed),1)
    income=int((D(income)/n).quantize(D(1),rounding='ROUND_HALF_UP'))
    expense=int((D(expense)/n).quantize(D(1),rounding='ROUND_HALF_UP'))
    reserved=sum(cents(g['contribution'])*(52 if g['frequency']=='Semanal' else 26 if g['frequency']=='Quinzenal' else 12)//12 for g in goals if g['saved'] < g['target'])
    capacity=max(income-expense-reserved,0)
    return dict(income=income/100,expense=expense/100,reserved=reserved/100,capacity=capacity/100,months_observed=len(observed),writes_data=False,method='media_realizada_menos_aportes_planejados',strategies=[dict(id='acelerado',label='Acelerado',amount=capacity/100),dict(id='equilibrado',label='Equilibrado',amount=(capacity*75//100)/100),dict(id='seguro',label='Seguro',amount=(capacity//2)/100)])
