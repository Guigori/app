"""FIN-09: compare user-supplied historical invoice evidence, without writes.

This tool never assumes an imported purchase marked 'paid' proves its CARD
INVOICE was paid. Evidence is a manually supplied external statement, not a
verified bank connection or migration authority.
"""
from collections import defaultdict
from finnos.lib.money import cents


def compare_invoice_evidence(cards: list[dict], txs: list[dict], evidence: list[dict]) -> dict:
    cards_by_id = {card["id"]: card for card in cards}
    receipts = defaultdict(int)
    for tx in txs:
        if tx.get("invoice_payment") and tx.get("status") == "pago":
            receipts[(tx.get("invoice_card_id"), tx.get("invoice_cycle"))] += cents(tx["value"])
    results = []
    for row in evidence:
        card_id, cycle = row["card_id"], row["cycle"]
        card = cards_by_id.get(card_id)
        if card is None:
            results.append({"card_id": card_id, "cycle": cycle,
                            "status": "unknown_card", "evidence_verified": False})
            continue
        saved = (card.get("invoice_cycles") or {}).get(cycle)
        saved_paid = saved.get("paid_cents") if isinstance(saved, dict) else None
        receipt_total = receipts[(card_id, cycle)]
        declared_paid = cents(row["declared_paid"])
        declared_total = cents(row["declared_invoice_total"])
        mismatch = []
        if declared_paid < 0 or declared_total < 0 or declared_paid > declared_total:
            mismatch.append("invalid_evidence_amounts")
        if saved_paid is None:
            mismatch.append("missing_cycle_snapshot")
        elif type(saved_paid) is not int or saved_paid < 0:
            mismatch.append("invalid_saved_cycle")
        elif saved_paid != declared_paid:
            mismatch.append("snapshot_paid_differs")
        if receipt_total != declared_paid:
            mismatch.append("bank_receipts_differ")
        if saved_paid is not None and type(saved_paid) is int and receipt_total != saved_paid:
            mismatch.append("internal_ledger_differs")
        results.append({
            "card_id": card_id, "cycle": cycle,
            "status": "manual_review" if mismatch else "values_match_unverified",
            "evidence_verified": False,
            "reported_total_cents": declared_total,
            "reported_paid_cents": declared_paid,
            "saved_paid_cents": saved_paid,
            "bank_receipt_cents": receipt_total,
            "differences": mismatch,
        })
    return {
        "status": "manual_review_required" if any(r["status"] != "values_match_unverified" for r in results)
                  else "values_match_external_evidence_unverified",
        "items": results,
        "matched_count": sum(r["status"] == "values_match_unverified" for r in results),
        "review_count": sum(r["status"] != "values_match_unverified" for r in results),
        "writes_data": False,
        "migration_reconciled": False,
        "external_statement_verified": False,
    }
