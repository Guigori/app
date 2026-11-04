"""Canonical amount of one recorded transaction occurrence (FIN-07/08).

A pending imported installment may have no stored installment_value. Never
project it as zero: derive the k/n portion from the original purchase total.
If a historical row already has an explicit installment_value, preserve it.
This helper does not book payments or alter Firestore documents.
"""
from finnos.lib.money import quantize_brl, installment_portion, remaining_installment_indices


def occurrence_amount(tx: dict):
    """Return the amount of this one occurrence as a quantized Decimal."""
    if not tx.get("installment"):
        return quantize_brl(tx["value"])
    stored = tx.get("installment_value")
    if stored is not None:
        return quantize_brl(stored)
    first_remaining = remaining_installment_indices(tx).start
    return quantize_brl(installment_portion(tx, first_remaining))
