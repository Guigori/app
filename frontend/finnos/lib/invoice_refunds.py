"""FIN-05b: bank reimbursements of already-settled card purchases.

A bank reimbursement is independent of the original invoice. The settled
invoice stays paid; the transaction credits the real bank account, and a
category reversal is counted in spending analytics on the refund date.
"""
from finnos.lib.invoices import invoice_state
from finnos.lib.invoice_credits import cycle_credits


def cycle_refunds(card, cycle):
    return list((card.get("invoice_refunds") or {}).get(cycle) or [])


def validate_bank_refund(card, txs, cycle, purchase_id, amount_cents):
    if not isinstance(amount_cents, int) or isinstance(amount_cents, bool) or amount_cents <= 0:
        raise ValueError("Valor de devolução inválido.")
    state = invoice_state(card, txs, cycle)
    if not state["paid"]:
        raise ValueError("Reembolso bancário exige fatura quitada; use crédito no saldo aberto.")
    items = [item for item in state["items"] if item["id"] == purchase_id]
    if len(items) != 1:
        raise ValueError("Compra não encontrada nesta fatura.")
    previous = sum(
        item["refund_cents"] for item in cycle_refunds(card, cycle)
        if item["purchase_id"] == purchase_id
    )
    credit = sum(
        item["credit_cents"] for item in cycle_credits(card, cycle)
        if item["purchase_id"] == purchase_id
    )
    if previous + credit + amount_cents > items[0]["purchase_cents"]:
        raise ValueError("Devoluções ultrapassam o valor da compra.")
    return state


def append_refund(card, entry):
    items = card.setdefault("invoice_refunds", {}).setdefault(entry["cycle"], [])
    if any(previous["id"] == entry["id"] for previous in items):
        raise ValueError("Reembolso já registrado.")
    items.append(entry)
