"""FIN-09: read-only historical invoice evidence review.

A card purchase marked 'pago' is NOT evidence that its invoice was paid.
Never infer settlement, generate bank debit, or change stored cycles.
This report distinguishes payment ledger mismatches from legitimate unpaid
historical cycles so legacy users can reconcile manually before migration.
"""
from collections import defaultdict
from datetime import date
from finnos.lib.invoices import occurrences
from finnos.lib.money import cents


def review_historical_invoices(cards: list[dict], txs: list[dict], today: str, *, sample_limit: int = 20) -> dict:
    count = {"unmatched_paid_snapshots": 0,
             "bank_payments_without_snapshot": 0,
             "archived_items_without_purchase": 0,
             "closed_cycles_without_snapshot": 0,
             "invalid_legacy_amounts": 0,
             "uninspectable_cards": 0}
    examples: list[dict] = []
    tx_by_id = {tx.get("id"): tx for tx in txs if tx.get("id")}
    by_card: dict[str, list[dict]] = defaultdict(list)
    payments: dict[tuple[str, str], int] = defaultdict(int)
    paid_receipts: set[tuple[str, str]] = set()

    def issue(code: str, card_id: str, cycle: str | None, **details):
        count[code] += 1
        if len(examples) < sample_limit:
            examples.append({"reason": code, "card_id": card_id, "cycle": cycle, **details})

    for tx in txs:
        if tx.get("invoice_payment"):
            key = (tx.get("invoice_card_id"), tx.get("invoice_cycle"))
            try:
                value = cents(tx["value"])
            except (ValueError, TypeError, KeyError):
                issue("invalid_legacy_amounts", key[0] or "", key[1])
                continue
            payments[key] += value
            paid_receipts.add(key)
        elif tx.get("card_id") and tx.get("type") == "despesa":
            by_card[tx["card_id"]].append(tx)

    reviewed = set()
    for card in cards:
        card_id = card["id"]
        saved = card.get("invoice_cycles") or {}
        card_purchases = by_card.get(card_id, [])
        for cycle, state in sorted(saved.items()):
            key = (card_id, cycle)
            reviewed.add(key)
            try:
                saved_paid = state.get("paid_cents", 0)
                if type(saved_paid) is not int or saved_paid < 0:
                    raise ValueError("invalid paid cents")
            except (AttributeError, ValueError, TypeError):
                issue("invalid_legacy_amounts", card_id, cycle)
                continue
            receipt_total = payments.get(key, 0)
            if saved_paid != receipt_total:
                issue("unmatched_paid_snapshots", card_id, cycle,
                      recorded_paid_cents=saved_paid,
                      matched_bank_payment_cents=receipt_total)
            for item in state.get("items") or []:
                original = tx_by_id.get(item.get("id"))
                if not original or original.get("card_id") != card_id:
                    issue("archived_items_without_purchase", card_id, cycle,
                          item_id=item.get("id"))
        closing = card.get("closing_day")
        if type(closing) is not int or not 1 <= closing <= 31:
            if card_purchases:
                issue("uninspectable_cards", card_id, None)
            continue
        cycles_seen = set()
        for purchase in card_purchases:
            try:
                for cycle, _, _ in occurrences(card, purchase):
                    if cycle < today and cycle not in saved:
                        cycles_seen.add(cycle)
            except (ValueError, KeyError, TypeError, OverflowError):
                issue("invalid_legacy_amounts", card_id, None)
        for cycle in sorted(cycles_seen):
            # A historical purchase without an invoice snapshot may simply be
            # unpaid; the software cannot label it paid automatically.
            issue("closed_cycles_without_snapshot", card_id, cycle)

    for key in sorted(paid_receipts - reviewed):
        if key[0] and key[1]:
            issue("bank_payments_without_snapshot", key[0], key[1],
                  matched_bank_payment_cents=payments[key])

    return {
        "status": "review_required" if any(count.values()) else "no_issues_detected_not_migration_verified",
        "counts": count,
        "examples": examples,
        "sample_limit": sample_limit,
        "auto_fixed": False,
        "legacy_source_compared": False,
    }
