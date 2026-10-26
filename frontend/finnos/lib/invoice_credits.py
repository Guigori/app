"""FIN-05: append-only, non-cash credits against an unpaid card invoice.

A credit note never rewrites a purchase or a bank payment. This first tranche
intentionally rejects credits that would exceed the outstanding invoice:
settled overpayments require an explicit bank-refund/carry-forward workflow.
No Firestore access here; callers persist atomically and deduplicate operation IDs.
"""


def cycle_credits(card: dict, cycle: str) -> list[dict]:
    return list((card.get("invoice_adjustments") or {}).get(cycle) or [])


def credit_total_cents(card: dict, cycle: str) -> int:
    return sum(item["amount_cents"] for item in cycle_credits(card, cycle))


def validate_credit(card: dict, txs: list[dict], cycle: str, purchase_id: str, amount_cents: int) -> dict:
    """Return the invoice before credit or reject unsafe/duplicate settlement."""
    from finnos.lib.invoices import invoice_state

    if not isinstance(amount_cents, int) or isinstance(amount_cents, bool) or amount_cents <= 0:
        raise ValueError("O valor do estorno deve ser positivo em centavos.")
    state = invoice_state(card, txs, cycle)
    matches = [line for line in state["items"] if line["id"] == purchase_id]
    if len(matches) != 1:
        raise ValueError("Compra não encontrada nesta fatura.")
    previous = sum(
        item["amount_cents"] for item in cycle_credits(card, cycle)
        if item["purchase_id"] == purchase_id
    )
    if previous + amount_cents > matches[0]["purchase_cents"]:
        raise ValueError("O estorno excede o valor ainda disponível dessa compra.")
    if amount_cents > state["total_cents"] - state["paid_cents"]:
        raise ValueError(
            "O estorno excede o saldo não pago. Faturas já quitadas exigem "
            "reembolso bancário ou crédito futuro auditado."
        )
    return state


def append_credit(card: dict, entry: dict) -> None:
    """Append once to a cycle. Only call after validation and within a transaction."""
    items = (card.setdefault("invoice_adjustments", {})
                 .setdefault(entry["cycle"], []))
    if any(previous["id"] == entry["id"] for previous in items):
        raise ValueError("Ajuste já registrado.")
    items.append(entry)
