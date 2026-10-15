"""Invoice occurrences belong to the first closing on/after purchase, then monthly.

Purchases represent expenses; payments represent bank movement only. All money
in this module is integer cents. Historical unpaid invoices retain the limit.
"""
from datetime import date
from finnos.lib.cards import cycle_bounds, due_date, _clamp_day
from finnos.lib.money import cents, installment_portion


def occurrences(card, tx):
    if tx.get('card_id') != card['id'] or tx.get('type') != 'despesa':
        return []
    purchase = date.fromisoformat(tx['date'])
    first = cycle_bounds(purchase, card['closing_day'])[1]
    n = int(tx.get('total_installments') or 1) if tx.get('installment') else 1
    first_index = first.year * 12 + (first.month - 1)
    results = []
    for i in range(n):
        year, month_index = divmod(first_index + i, 12)
        closing = _clamp_day(year, month_index + 1, card['closing_day'])
        value = cents(installment_portion(tx, i)) if tx.get('installment') else cents(tx['value'])
        results.append((closing.isoformat(), value, f'{i+1}/{n}' if n > 1 else None))
    return results


def invoice_state(card, txs, cycle, categories=None):
    closing = date.fromisoformat(cycle)
    if closing != _clamp_day(closing.year, closing.month, card['closing_day']):
        raise ValueError('Ciclo deve indicar a data de fechamento do cartão.')
    start = cycle_bounds(closing, card['closing_day'])[0].isoformat()
    categories = categories or {}
    items = []
    for tx in txs:
        for key, value, label in occurrences(card, tx):
            if key != cycle:
                continue
            cat = categories.get(tx.get('category_id'), {})
            items.append(dict(id=tx['id'],name=tx['name'],date=tx['date'],purchase_cents=value,category_name=cat.get('name'),category_color=cat.get('color'),installment_label=label))
    saved = (card.get('invoice_cycles') or {}).get(cycle)
    if saved:
        items = saved['items']
    total = sum(i['purchase_cents'] for i in items)
    paid = (saved or {}).get('paid_cents', 0)
    return dict(card_id=card['id'],card_name=card['name'],cycle_start=start,cycle_end=cycle,due_date=due_date(closing,card['closing_day'],card['due_day']).isoformat(),total_cents=total,paid_cents=paid,paid=total > 0 and paid == total,paid_at=(saved or {}).get('paid_at'),items=items)


def output(state):
    return {**{k:v for k,v in state.items() if k not in {'total_cents','paid_cents','items'}},'total':state['total_cents']/100,'paid_amount':state['paid_cents']/100,'outstanding':(state['total_cents']-state['paid_cents'])/100,'items':[{**{k:v for k,v in i.items() if k != 'purchase_cents'},'value':i['purchase_cents']/100} for i in state['items']]}


def commitment(card, txs, current):
    totals = {}
    for tx in txs:
        for key, value, _ in occurrences(card, tx):
            totals[key] = totals.get(key, 0) + value
    for key, saved in (card.get('invoice_cycles') or {}).items():
        totals[key] = sum(i['purchase_cents'] for i in saved['items'])
    owed = {key:max(0,total-(card.get('invoice_cycles') or {}).get(key,{}).get('paid_cents',0)) for key,total in totals.items()}
    return owed.get(current,0),sum(v for k,v in owed.items() if k > current),sum(owed.values())
