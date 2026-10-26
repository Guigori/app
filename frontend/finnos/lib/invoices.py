"""Invoice occurrences belong to the first closing on/after purchase, then monthly.

Purchases represent expenses; payments represent bank movement only. All money
in this module is integer cents. Historical unpaid invoices retain the limit.
"""
from datetime import date
from finnos.lib.cards import cycle_bounds, due_date, _clamp_day
from finnos.lib.money import cents, installment_portion, remaining_installment_indices
from finnos.lib.invoice_credits import cycle_credits, credit_total_cents


def occurrences(card, tx):
    if tx.get('card_id') != card['id'] or tx.get('type') != 'despesa':
        return []
    purchase = date.fromisoformat(tx['date'])
    first = cycle_bounds(purchase, card['closing_day'])[1]
    n = int(tx.get('total_installments') or 1) if tx.get('installment') else 1
    indices = remaining_installment_indices(tx) if tx.get('installment') else range(1)
    first_index = first.year * 12 + (first.month - 1)
    results = []
    for month_offset, installment_index in enumerate(indices):
        year, month_index = divmod(first_index + month_offset, 12)
        closing = _clamp_day(year, month_index + 1, card['closing_day'])
        value = cents(installment_portion(tx, installment_index)) if tx.get('installment') else cents(tx['value'])
        results.append((closing.isoformat(), value, f'{installment_index+1}/{n}' if n > 1 else None))
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
        # Payments preserve a snapshot of the purchases already present. New
        # purchases can still enter a cycle that was paid before closing.
        # Keep snapshotted lines authoritative and append only unseen items.
        archived = list(saved.get('items') or [])
        known = {item['id'] for item in archived}
        items = archived + [
            item for item in items
            if item['id'] not in known
        ]
    adjustments = cycle_credits(card, cycle)
    total = sum(i['purchase_cents'] for i in items) - credit_total_cents(card, cycle)
    paid = (saved or {}).get('paid_cents', 0)
    return dict(card_id=card['id'],card_name=card['name'],cycle_start=start,cycle_end=cycle,due_date=due_date(closing,card['closing_day'],card['due_day']).isoformat(),total_cents=total,paid_cents=paid,paid=total > 0 and paid == total,paid_at=(saved or {}).get('paid_at'),items=items,adjustments=adjustments,adjustment_cents=credit_total_cents(card, cycle))


def default_invoice_cycle(card, txs, today):
    """Select the oldest closed, unpaid invoice; otherwise the open cycle.

    Invoice dates are closing dates (stable FINNOS identifiers), not due months.
    No historical cycle or payment is modified by this read-only selection.
    """
    open_cycle = cycle_bounds(today, card['closing_day'])[1].isoformat()
    closed = set((card.get('invoice_cycles') or {}).keys())
    for tx in txs:
        for cycle, _, _ in occurrences(card, tx):
            if cycle < today.isoformat():
                closed.add(cycle)
    for cycle in sorted(closed):
        if cycle >= today.isoformat():
            continue
        state = invoice_state(card, txs, cycle)
        if state['total_cents'] > state['paid_cents']:
            return cycle
    return open_cycle


def output(state):
    return {
        **{k: v for k, v in state.items() if k not in {
            'total_cents', 'paid_cents', 'items', 'adjustments', 'adjustment_cents'
        }},
        'total': state['total_cents'] / 100,
        'paid_amount': state['paid_cents'] / 100,
        'outstanding': (state['total_cents'] - state['paid_cents']) / 100,
        'adjustment_total': state.get('adjustment_cents', 0) / 100,
        'items': [
            {**{k: v for k, v in item.items() if k != 'purchase_cents'},
             'value': item['purchase_cents'] / 100}
            for item in state['items']
        ],
        'adjustments': [
            {
                'id': entry['id'],
                'purchase_id': entry['purchase_id'],
                'date': entry['date'],
                'reason': entry['reason'],
                'value': entry['credit_cents'] / 100,
            } for entry in state.get('adjustments', [])
        ],
    }


def commitment(card, txs, current):
    """Total current, future and used credit in cents, including early payments.

    A partially paid open cycle may gain purchases. The archived invoice lines
    take precedence for existing purchases, but must not hide newly added lines.
    """
    lines = {}
    for tx in txs:
        for cycle, value, label in occurrences(card, tx):
            lines.setdefault(cycle, {})[tx['id']] = value
    saved_cycles = card.get('invoice_cycles') or {}
    for cycle, saved in saved_cycles.items():
        bucket = lines.setdefault(cycle, {})
        for item in saved.get('items') or []:
            bucket[item['id']] = item['purchase_cents']
    for cycle in card.get('invoice_adjustments') or {}:
        lines.setdefault(cycle, {})
    owed = {
        cycle: max(0, sum(bucket.values()) - credit_total_cents(card, cycle)
                   - saved_cycles.get(cycle, {}).get('paid_cents', 0))
        for cycle, bucket in lines.items()
    }
    return (
        owed.get(current, 0),
        sum(amount for cycle, amount in owed.items() if cycle > current),
        sum(owed.values()),
    )


def purchase_write_conflict(card, tx, today: str, original=None) -> str | None:
    """Protect settled history while allowing fresh purchases in an open cycle.

    This is a pure validation rule: existing purchases are not editable after
    a payment touches their cycle, but a NEW purchase can increase the open
    invoice before closing. Closed paid cycles remain immutable.
    """
    saved_cycles = card.get('invoice_cycles') or {}
    adjusted = card.get('invoice_adjustments') or {}
    if not saved_cycles and not adjusted:
        return None
    if original and any(
        item.get('purchase_id') == original.get('id')
        for entries in adjusted.values() for item in entries
    ):
        return "Compra possui estorno auditado e não pode ser alterada ou excluída."
    if original:
        if any(cycle in saved_cycles for cycle, _, _ in occurrences(card, original)):
            return "Compra vinculada a fatura com pagamentos; alteração exige estorno auditado."
        if any(
            item.get('id') == original.get('id')
            for cycle in saved_cycles.values()
            for item in cycle.get('items') or []
        ):
            return "Compra vinculada a fatura com pagamentos; alteração exige estorno auditado."
    for cycle, _, _ in occurrences(card, tx):
        if cycle in saved_cycles and cycle < today:
            return "Fatura fechada com pagamentos não aceita novas compras retroativas."
    return None
