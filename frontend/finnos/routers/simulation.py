"""Read-only purchase scenarios using actual scoped balances and invoice cycles."""
from datetime import date,timedelta
from fastapi import APIRouter,Depends,HTTPException
from pydantic import Field
from finnos.lib.money import FinanceModel,Money,cents,installment_portion
from finnos.lib.db import db
from finnos.lib.stats import balance_effects
from finnos.lib.dates import today_iso
from finnos.lib.invoices import occurrences,invoice_state
from finnos.lib.cards import cycle_bounds,due_date
from finnos.routers.auth import require_user
from finnos.routers.cards import _build,_context
from finnos.routers.budgets import _progress
router=APIRouter(prefix='/simulate',tags=['simulation'])
class PurchaseSimulationIn(FinanceModel):
    amount:Money=Field(gt=0)
    installments:int=Field(1,ge=1,le=48)
    card_id:str|None=None
    category_id:str|None=None
    compare_installments:bool=True

@router.post('/purchase')
async def purchase(payload:PurchaseSimulationIn,user=Depends(require_user)):
    uid=user['id'];today=date.fromisoformat(today_iso());horizon=today+timedelta(days=30)
    accounts=await db.accounts.find({'user_id':uid}).to_list(500)
    txs=await db.transactions.find({'user_id':uid}).to_list(20000)
    cards=await db.cards.find({'user_id':uid}).to_list(200)
    balance=sum(cents(a.get('initial_balance',0)) for a in accounts)
    balance+=sum(cents(amount) for tx in txs for _,amount in balance_effects(tx,today.isoformat()))
    from finnos.lib.cash_projection import project_scheduled_cash
    subscriptions=await db.subscriptions.find({'user_id':uid}).to_list(500)
    forecast=project_scheduled_cash(txs,balance,today,horizon,subscriptions)
    projected=forecast['projected_cents']
    for card in cards:
        keys={key for tx in txs for key,_,_ in occurrences(card,tx)}|set((card.get('invoice_cycles') or {}))
        for key in keys:
            state=invoice_state(card,txs,key)
            if date.fromisoformat(state['due_date'])<=horizon:
                projected-=state['total_cents']-state['paid_cents']
    selected=next((c for c in cards if c['id']==payload.card_id and c.get('active',True)),None)
    if payload.card_id and not selected:raise HTTPException(404,'Cartão não encontrado.')
    if payload.category_id and not await db.categories.find_one({'user_id':uid,'id':payload.category_id}):raise HTTPException(400,'Categoria inválida.')
    amount=cents(payload.amount)
    def impact(parts):
        parcel=cents(installment_portion({'value':payload.amount,'total_installments':parts},0))
        if selected:
            closing=cycle_bounds(today,selected['closing_day'])[1]
            return parcel if due_date(closing,selected['closing_day'],selected['due_day'])<=horizon else 0
        return amount if parts==1 else parcel
    card_out=None
    if selected:
        card_txs,account_map=await _context(uid);current=await _build(selected,card_txs,account_map)
        available=cents(current.available)
        parcel=cents(installment_portion({'value':payload.amount,'total_installments':payload.installments},0))
        card_out=dict(id=current.id,name=current.name,available_before=available/100,available_after=(available-amount)/100,fits_limit=available>=amount,current_invoice_before=float(current.current_invoice),current_invoice_after=(cents(current.current_invoice)+parcel)/100,future_installments_before=float(current.future_installments),future_installments_after=(cents(current.future_installments)+amount-parcel)/100)
    budget=None
    cycle=await db.budget_cycles.find_one({'user_id':uid,'start_date':{'$lte':today.isoformat()},'end_date':{'$gte':today.isoformat()},'closed_at':None})
    if cycle and payload.category_id:
        progress=await _progress(cycle,uid)
        allocation=next((a for a in progress.allocations if a.category_id==payload.category_id),None)
        if allocation:
            used=cents(installment_portion({'value':payload.amount,'total_installments':payload.installments},0))
            available=cents(allocation.available)
            budget=dict(category_id=payload.category_id,planned=float(allocation.planned),spent=float(allocation.spent),committed=float(allocation.committed),available_before=available/100,available_after=(available-used)/100,fits_budget=available>=used)
    after=projected-impact(payload.installments)
    level='confortavel' if after>=amount//5 and (not card_out or card_out['fits_limit']) and (not budget or budget['fits_budget']) else 'apertado' if after>=0 and (not card_out or card_out['fits_limit']) else 'critico'
    scenarios=[dict(installments=n,installment_value=float(installment_portion({'value':payload.amount,'total_installments':n},0)),projected_30d_after=(projected-impact(n))/100,card_limit_after=card_out['available_after'] if card_out else None) for n in (1,3,6,12)] if payload.compare_installments else []
    return dict(amount=amount/100,installments=payload.installments,installment_value=float(installment_portion({'value':payload.amount,'total_installments':payload.installments},0)),balance_now=balance/100,projected_30d_before=projected/100,projected_30d_after=after/100,cash_impact_30d=impact(payload.installments)/100,card=card_out,budget=budget,level=level,scenarios=scenarios,writes_data=False)
