from finnos.lib.money import D, installment_portion, remaining_installment_indices, FinanceModel, Money, quantize_brl
"""Budget V2 — versioned cycles. Existing monthly category budgets remain untouched."""
import uuid
from datetime import date, datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from finnos.lib.db import db
from finnos.lib.dates import today_iso
from finnos.lib.recurrence import projections_in_period
from finnos.lib.subscription_projection import planned_subscriptions_in_period
from finnos.lib.competency import credit_events, monthly_competency
from finnos.models.budget import BudgetAllocationOut, BudgetAllocationProgress, BudgetCycleIn, BudgetCycleOut, BudgetCycleProgress
from finnos.routers.auth import require_user
router = APIRouter(prefix='/budgets', tags=['budgets'])

def _status(cycle: dict, today: date) -> str:
    start = date.fromisoformat(str(cycle['start_date']))
    end = date.fromisoformat(str(cycle['end_date']))
    if cycle.get('closed_at') or end < today:
        return 'fechado'
    if start > today:
        return 'programado'
    return 'ativo'

async def _out(cycle: dict) -> BudgetCycleOut:
    category_ids = [a['category_id'] for a in cycle.get('allocations', [])]
    categories = await db.categories.find({'user_id': cycle['user_id'], 'id': {'$in': category_ids}}).to_list(500) if category_ids else []
    by_id = {c['id']: c for c in categories}
    allocations = [BudgetAllocationOut(**allocation, name=by_id.get(allocation['category_id'], {}).get('name'), icon=by_id.get(allocation['category_id'], {}).get('icon'), color=by_id.get(allocation['category_id'], {}).get('color')) for allocation in cycle.get('allocations', [])]
    payload = {k: v for (k, v) in cycle.items() if k not in {'_id', 'user_id', 'allocations', 'status'}}
    return BudgetCycleOut(**payload, allocations=allocations, status=_status(cycle, date.fromisoformat(today_iso())))

def _tx_amount(tx: dict) -> float:
    return quantize_brl(D(tx.get('installment_value') or 0)) if tx.get('installment') else quantize_brl(D(tx.get('value') or 0))

def _occurrences_in_cycle(tx: dict, start: date, end: date):
    if tx.get('invoice_payment') or tx.get('invoice_refund') or tx.get('type') == 'transferencia':
        return []
    import calendar
    tx_date = date.fromisoformat(tx['date'])
    (amount, realised) = (_tx_amount(tx), tx.get('status') == 'pago')
    out = []
    if tx.get('installment'):
        for offset, installment_index in enumerate(remaining_installment_indices(tx)):
            idx = tx_date.year * 12 + tx_date.month - 1 + offset
            (yy, mm) = (idx // 12, idx % 12 + 1)
            occurrence = date(yy, mm, min(tx_date.day, calendar.monthrange(yy, mm)[1]))
            if start <= occurrence <= end:
                out.append((occurrence, installment_portion(tx, installment_index), realised and occurrence <= date.fromisoformat(today_iso())))
        return out
    if start <= tx_date <= end:
        out.append((tx_date, amount, realised))
    return out

async def _progress(cycle: dict, user_id: str) -> BudgetCycleProgress:
    (start, end, today) = (date.fromisoformat(str(cycle['start_date'])), date.fromisoformat(str(cycle['end_date'])), date.fromisoformat(today_iso()))
    txs = await db.transactions.find({'user_id': user_id}).to_list(20000)
    categories = await db.categories.find({'user_id': user_id}).to_list(500)
    cards = await db.cards.find({'user_id': user_id}).to_list(200)
    subscriptions = await db.subscriptions.find({'user_id': user_id}).to_list(500)
    by_id = {cat['id']: cat for cat in categories}
    (spent_by_cat, committed_by_cat) = ({}, {})
    received_income = committed_income = D('0.0')
    for tx in txs:
        for (occurrence, amount, realised) in _occurrences_in_cycle(tx, start, end):
            if tx.get('type') == 'receita':
                if realised:
                    received_income += amount
                else:
                    committed_income += amount
            elif tx.get('type') == 'despesa' and tx.get('category_id'):
                target = spent_by_cat if realised else committed_by_cat
                key = tx['category_id']
                target[key] = target.get(key, 0) + amount
    # Financial credit events reverse spending on the date confirmed.
    for event in credit_events(cards, txs):
        if start <= date.fromisoformat(event["date"]) <= end and event["category_id"]:
            key = event["category_id"]
            spent_by_cat[key] = spent_by_cat.get(key, D("0.0")) - D(event["cents"]) / 100
    # Recurrence expansion happens once per series/period, independently of
    # the individual historical rows that established it.
    for source, occurrence in projections_in_period(txs, start, end):
        amount = _tx_amount(source)
        if source.get('type') == 'receita':
            committed_income += amount
        elif source.get('type') == 'despesa' and source.get('category_id'):
            key = source['category_id']
            committed_by_cat[key] = committed_by_cat.get(key, D('0.0')) + amount
    # FIN-13: include only deduplicated upcoming bills in category
    # commitments. These are plans, never realized cash movements.
    for sub, charge in planned_subscriptions_in_period(
        subscriptions, txs, start, end, today.isoformat()
    ):
        if sub.get('category_id'):
            key = sub['category_id']
            committed_by_cat[key] = (
                committed_by_cat.get(key, D('0.0')) + D(sub['value'])
            )
    allocations = []
    for allocation in cycle.get('allocations', []):
        (key, planned) = (allocation['category_id'], quantize_brl(D(allocation.get('planned') or 0)))
        (spent, committed) = (quantize_brl(spent_by_cat.get(key, 0)), quantize_brl(committed_by_cat.get(key, 0)))
        (projected, cat) = (quantize_brl(spent + committed), by_id.get(key, {}))
        allocations.append(BudgetAllocationProgress(**allocation, name=cat.get('name'), icon=cat.get('icon'), color=cat.get('color'), spent=spent, committed=committed, available=quantize_brl(planned - projected), projected_close=projected, percent=round(projected / planned * 100, 1) if planned else 0))
    (planned, spent, committed) = (quantize_brl(sum((a.planned for a in allocations))), quantize_brl(sum((a.spent for a in allocations))), quantize_brl(sum((a.committed for a in allocations))))
    projected = quantize_brl(spent + committed)
    duration = max((end - start).days + 1, 1)
    elapsed = 0 if today < start else duration if today > end else (today - start).days + 1
    (elapsed_percent, used_percent) = (round(elapsed / duration * 100, 1), round(projected / planned * 100, 1) if planned else 0)
    pace = 'sem_plano' if not planned else 'acima' if used_percent > elapsed_percent + 10 else 'abaixo' if used_percent < max(elapsed_percent - 10, 0) else 'no_ritmo'
    expected_income = quantize_brl(D(cycle.get('expected_income') or 0))
    income_base = max(expected_income, quantize_brl(received_income + committed_income))
    return BudgetCycleProgress(cycle_id=cycle['id'], start_date=start, end_date=end, planned=planned, spent=spent, committed=committed, available=quantize_brl(planned - projected), projected_close=projected, expected_income=expected_income, received_income=quantize_brl(received_income), committed_income=quantize_brl(committed_income), safe_to_spend=quantize_brl(max(income_base - spent - committed, 0)), elapsed_percent=elapsed_percent, used_percent=used_percent, pace=pace, allocations=allocations)

@router.get('/suggestion')
async def budget_suggestion(user: dict=Depends(require_user)):
    """Suggest category limits from recent behaviour; never writes a budget."""
    today = date.fromisoformat(today_iso())
    current_idx = today.year * 12 + today.month - 1
    start_idx = current_idx - 3
    (sy, sm) = (start_idx // 12, start_idx % 12 + 1)
    (ey, em) = ((current_idx - 1) // 12, (current_idx - 1) % 12 + 1)
    # Reuse the same competency semantics as Home, Flow and Budget:
    # installments, merchant credits and bank refunds are all reconciled in
    # cents. In particular a refunded card purchase must not inflate the
    # suggested salary/income or generate a second spent category.
    txs = await db.transactions.find({'user_id': user['id']}).to_list(20000)
    cards = await db.cards.find({'user_id': user['id']}).to_list(200)
    cats = await db.categories.find({'user_id': user['id']}).to_list(500)
    by_id = {cat['id']: cat for cat in cats}
    month_keys = [f'{(start_idx + i) // 12:04d}-{(start_idx + i) % 12 + 1:02d}' for i in range(3)]
    monthly = {key: monthly_competency(txs, cards, key) for key in month_keys}
    suggestions = []
    for cid, cat in by_id.items():
        # Net refunds may make a month negative; the prospective spending
        # limit cannot be negative, but historical reports keep the signed
        # amount for faithful audit.
        vals = [max(D('0.0'), monthly[key]['by_category'].get(cid, D('0.0')))
                for key in month_keys]
        if not any(vals):
            continue
        avg = quantize_brl(sum(vals) / 3)
        buffer = D('1.05') if cat.get('group') == 'necessidades' else D('1.0')
        planned = quantize_brl(avg * buffer)
        suggestions.append({
            'category_id': cid, 'name': cat.get('name'),
            'group': cat.get('group'), 'average': avg,
            'suggested': planned,
            'months_observed': sum(value > 0 for value in vals),
        })
    suggestions.sort(key=lambda item: -item['suggested'])
    expected_income = quantize_brl(
        sum((monthly[key]['income'] for key in month_keys), D('0.0')) / 3)
    return {'expected_income': expected_income, 'categories': suggestions, 'method': 'media_recente', 'writes_data': False}

@router.get('', response_model=List[BudgetCycleOut])
async def list_cycles(status: Optional[str]=Query(default=None, pattern='^(programado|ativo|fechado)$'), user: dict=Depends(require_user)) -> List[BudgetCycleOut]:
    cycles = await db.budget_cycles.find({'user_id': user['id']}).sort('start_date', -1).to_list(500)
    output = [await _out(c) for c in cycles]
    return [c for c in output if c.status == status] if status else output

@router.get('/current', response_model=Optional[BudgetCycleOut])
async def current_cycle(user: dict=Depends(require_user)):
    today = date.fromisoformat(today_iso()).isoformat()
    cycle = await db.budget_cycles.find_one({'user_id': user['id'], 'start_date': {'$lte': today}, 'end_date': {'$gte': today}, 'closed_at': None}, sort=[('start_date', -1)])
    return await _out(cycle) if cycle else None

@router.get('/next', response_model=Optional[BudgetCycleOut])
async def next_cycle(user: dict=Depends(require_user)):
    today = date.fromisoformat(today_iso()).isoformat()
    cycle = await db.budget_cycles.find_one({'user_id': user['id'], 'start_date': {'$gt': today}, 'closed_at': None}, sort=[('start_date', 1)])
    return await _out(cycle) if cycle else None

@router.get('/{cycle_id}/progress', response_model=BudgetCycleProgress)
async def cycle_progress(cycle_id: str, user: dict=Depends(require_user)) -> BudgetCycleProgress:
    cycle = await db.budget_cycles.find_one({'id': cycle_id, 'user_id': user['id']})
    if not cycle:
        raise HTTPException(status_code=404, detail='Orçamento não encontrado.')
    return await _progress(cycle, user['id'])

@router.post('', response_model=BudgetCycleOut, status_code=201)
async def create_cycle(input: BudgetCycleIn, user: dict=Depends(require_user)) -> BudgetCycleOut:
    (start, end) = (input.start_date.isoformat(), input.end_date.isoformat())
    overlap = await db.budget_cycles.find_one({'user_id': user['id'], 'closed_at': None, 'start_date': {'$lte': end}, 'end_date': {'$gte': start}})
    if overlap:
        raise HTTPException(status_code=409, detail='Já existe um orçamento nesse período.')
    now = datetime.now(timezone.utc).isoformat()
    doc = {**input.model_dump(), 'start_date':start, 'end_date':end}
    doc.update({'id': str(uuid.uuid4()), 'user_id': user['id'], 'created_at': now, 'closed_at': None})
    await db.budget_cycles.insert_one(doc)
    return await _out(doc)

@router.put('/{cycle_id}', response_model=BudgetCycleOut)
async def update_cycle(cycle_id: str, input: BudgetCycleIn, user: dict=Depends(require_user)) -> BudgetCycleOut:
    current = await db.budget_cycles.find_one({'id': cycle_id, 'user_id': user['id']})
    if not current:
        raise HTTPException(status_code=404, detail='Orçamento não encontrado.')
    if _status(current, date.fromisoformat(today_iso())) == 'fechado':
        raise HTTPException(status_code=409, detail='O histórico de um orçamento fechado não pode ser alterado.')
    (start, end) = (input.start_date.isoformat(), input.end_date.isoformat())
    overlap = await db.budget_cycles.find_one({'user_id': user['id'], 'id': {'$ne': cycle_id}, 'closed_at': None, 'start_date': {'$lte': end}, 'end_date': {'$gte': start}})
    if overlap:
        raise HTTPException(status_code=409, detail='Já existe outro orçamento nesse período.')
    patch = {**input.model_dump(), 'start_date':start, 'end_date':end}
    await db.budget_cycles.update_one({'id': cycle_id, 'user_id': user['id']}, {'$set': patch})
    updated = {**current, **patch}
    return await _out(updated)
