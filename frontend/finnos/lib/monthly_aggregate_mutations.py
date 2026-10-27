"""ARQ-02: pure, fail-closed planning of shadow monthly aggregate mutations.

This is an *offline model* of the inputs needed from the actual write paths:
transaction CRUD/import/offline replay, card credit/refund changes, and invoice
payment receipts. It does not write Firestore, install an adapter hook, or
authorize shadow data to serve Dashboard/Fluxo.

A critical dependency: reclassifying a refunded original purchase changes
the category of the credit in a *later month*, even when the card document
itself is not edited. Recompute both sides with their respective originals.
"""
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from finnos.lib.monthly_aggregate_shadow import IncrementalMonthlyLedger
from finnos.lib.projection_reads import referenced_purchase_ids


@dataclass
class ShadowMutationResult:
    ledger: IncrementalMonthlyLedger
    transactions: dict[str, dict]
    cards: dict[str, dict]
    changed_months: list[str]
    revision: int


def _validate_change(
    changes: list[tuple[dict | None, dict | None]],
    existing: dict[str, dict],
    kind: str,
) -> dict[str, dict]:
    updated = dict(existing)
    touched = set()
    for before, after in changes:
        if before is None and after is None:
            raise ValueError(f"Mutação sem {kind}.")
        identifier = (after or before).get("id")
        if not isinstance(identifier, str) or not identifier:
            raise ValueError(f"Identificador de {kind} inválido.")
        if before is not None and before.get("id") != identifier:
            raise ValueError(f"Identificador inicial de {kind} diferente.")
        if after is not None and after.get("id") != identifier:
            raise ValueError(f"Identificador final de {kind} diferente.")
        if identifier in touched:
            raise ValueError(f"Mutação duplicada de {kind} no lote.")
        touched.add(identifier)
        if before is None:
            if identifier in updated:
                raise ValueError(f"Criação repetida de {kind}; revisão necessária.")
        elif updated.get(identifier) != before:
            raise ValueError(f"Pré-imagem de {kind} desatualizada.")
        if after is None:
            updated.pop(identifier)
        else:
            updated[identifier] = deepcopy(after)
    return updated


def apply_shadow_mutations(
    ledger: IncrementalMonthlyLedger,
    transactions: dict[str, dict],
    cards: dict[str, dict],
    *,
    transaction_changes: list[tuple[dict | None, dict | None]] | None = None,
    card_changes: list[tuple[dict | None, dict | None]] | None = None,
    before_revision: int,
    after_revision: int,
) -> ShadowMutationResult:
    """Apply an ordered batch as a pure simulation; reject stale/partial data.

    Future persistence must enforce these exact revision/operation boundaries
    INSIDE the canonical Firestore transaction. In the meantime this validates
    full reconstruction parity without touching real data.
    """
    if (type(before_revision) is not int or before_revision < 0
            or type(after_revision) is not int
            or after_revision != before_revision + 1):
        raise ValueError("Revisão incremental não é consecutiva.")
    tx_changes = transaction_changes or []
    card_deltas = card_changes or []
    if not tx_changes and not card_deltas:
        raise ValueError("Lote financeiro vazio.")

    # Preflight ALL changes before any delta is applied.
    after_transactions = _validate_change(tx_changes, transactions, "lançamento")
    after_cards = _validate_change(card_deltas, cards, "cartão")
    updated_ids = {
        (after or before)["id"]
        for before, after in tx_changes
    }
    changed_card_ids = {
        (after or before)["id"]
        for before, after in card_deltas
    }
    affected_card_ids = set(changed_card_ids)
    for identifier in set(cards) | set(after_cards):
        if identifier in affected_card_ids:
            continue
        before = cards.get(identifier)
        after = after_cards.get(identifier)
        if updated_ids & (
            referenced_purchase_ids([before] if before else [])
            | referenced_purchase_ids([after] if after else [])
        ):
            affected_card_ids.add(identifier)

    candidate = deepcopy(ledger)
    old_rows = {
        month: values.row() for month, values in candidate.months.items()
    }
    # Deallocate credit effects against the *old* original purchase categories
    # BEFORE processing a deletion/category edit. Every related card has the
    # same source-of-truth original snapshot from its corresponding revision.
    for identifier in sorted(affected_card_ids):
        original_card = cards.get(identifier)
        if original_card is not None:
            candidate.card_credits_changed(original_card, None, transactions)

    for before, after in tx_changes:
        candidate.transaction_changed(before, after)

    for identifier in sorted(affected_card_ids):
        latest_card = after_cards.get(identifier)
        if latest_card is not None:
            candidate.card_credits_changed(None, latest_card, after_transactions)

    new_rows = {
        month: values.row() for month, values in candidate.months.items()
    }
    months = sorted(
        month for month in set(old_rows) | set(new_rows)
        if old_rows.get(month) != new_rows.get(month)
    )
    return ShadowMutationResult(
        ledger=candidate, transactions=after_transactions,
        cards=after_cards, changed_months=months, revision=after_revision,
    )
