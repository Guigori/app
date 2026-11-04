"""Pure checks for the active Firestore financial data model.

Passing this audit does NOT prove that an earlier MongoDB account has been
migrated. Legacy reconciliation is an independent operator-controlled step.
"""
from collections import Counter
from finnos.lib.money import D, cents
from finnos.lib.stats import balance_effects
from finnos.lib.dates import today_iso
from finnos.lib.legacy_reconciliation import review_historical_invoices
from finnos.lib.money import quantize_brl
from decimal import InvalidOperation

KINDS = ("accounts", "categories", "cards", "transactions", "goals", "budget_cycles", "subscriptions")


def same_money_in_cents(value, expected):
    try:
        return cents(value) == expected
    except (TypeError, ValueError, InvalidOperation):
        return False



def audit_finance(records):
    accounts = {row["id"] for row in records["accounts"]}
    categories = {row["id"] for row in records["categories"]}
    cards = {row["id"] for row in records["cards"]}
    problems = Counter()

    for card in records["cards"]:
        if card.get("payment_account_id") and card["payment_account_id"] not in accounts:
            problems["card_payment_account_missing"] += 1

    for tx in records["transactions"]:
        if tx.get("account_id") not in accounts:
            problems["transaction_source_account_missing"] += 1
        if tx.get("to_account_id") and tx["to_account_id"] not in accounts:
            problems["transaction_target_account_missing"] += 1
        if tx.get("category_id") and tx["category_id"] not in categories:
            problems["transaction_category_missing"] += 1
        if tx.get("card_id") and tx["card_id"] not in cards:
            problems["transaction_card_missing"] += 1
        if tx.get("type") == "transferencia" and (
            not tx.get("to_account_id") or tx["to_account_id"] == tx.get("account_id")
        ):
            problems["transaction_transfer_invalid"] += 1
        if tx.get("invoice_payment") and tx.get("invoice_card_id") not in cards:
            problems["invoice_payment_card_missing"] += 1

    # FIN-05 integrity: a compensation must reference an original purchase
    # on the same card. A bank reimbursement must have exactly one matching
    # cash receipt; otherwise Dashboard and bank balances can silently drift.
    purchases = {tx["id"]: tx for tx in records["transactions"] if tx.get("id")}
    refund_ledger_ids = set()
    for card in records["cards"]:
        seen_adjustments = set()
        for kind, ledger, amount_key in (
            ("credit", card.get("invoice_adjustments") or {}, "credit_cents"),
            ("refund", card.get("invoice_refunds") or {}, "refund_cents"),
        ):
            for cycle, entries in ledger.items():
                for entry in entries:
                    entry_id = entry.get("id")
                    key = (kind, entry_id)
                    if not entry_id or key in seen_adjustments:
                        problems["invoice_adjustment_duplicate_id"] += 1
                    seen_adjustments.add(key)
                    purchase = purchases.get(entry.get("purchase_id"))
                    if not purchase or purchase.get("card_id") != card.get("id"):
                        problems["invoice_adjustment_original_missing"] += 1
                    amount = entry.get(amount_key)
                    if type(amount) is not int or amount <= 0:
                        problems["invoice_adjustment_amount_invalid"] += 1
                    if kind != "refund":
                        continue
                    refund_ledger_ids.add(entry_id)
                    receipt = purchases.get(entry_id)
                    if (
                        not receipt or not receipt.get("invoice_refund")
                        or receipt.get("invoice_card_id") != card.get("id")
                        or receipt.get("invoice_cycle") != cycle
                        or receipt.get("original_purchase_id") != entry.get("purchase_id")
                        or receipt.get("account_id") != entry.get("account_id")
                        or receipt.get("status") != "pago"
                        or type(amount) is not int
                        or not same_money_in_cents(receipt.get("value"), amount)
                    ):
                        problems["invoice_refund_receipt_missing_or_mismatch"] += 1
    for tx in records["transactions"]:
        if tx.get("invoice_refund") and tx.get("id") not in refund_ledger_ids:
            problems["invoice_refund_orphan_receipt"] += 1

    for subscription in records["subscriptions"]:
        if subscription.get("account_id") not in accounts:
            problems["subscription_account_missing"] += 1
        if subscription.get("category_id") and subscription["category_id"] not in categories:
            problems["subscription_category_missing"] += 1
        if subscription.get("card_id") and subscription["card_id"] not in cards:
            problems["subscription_card_missing"] += 1

    for goal in records["goals"]:
        if goal.get("account") not in accounts:
            problems["goal_account_missing"] += 1

    for budget in records["budget_cycles"]:
        for allocation in budget.get("allocations", []):
            if allocation.get("category_id") not in categories:
                problems["budget_category_missing"] += 1

    total_balance = sum((D(acc.get("initial_balance") or 0) for acc in records["accounts"]), D(0))
    # Only compute a total when all account references exist; otherwise it
    # would conceal missing destinations or generate a misleading balance.
    if not problems:
        for tx in records["transactions"]:
            for _, amount in balance_effects(tx, today_iso()):
                total_balance += amount

    counts = {kind: len(records[kind]) for kind in KINDS}
    return {
        "storage": "firestore",
        "integrity_ok": not problems,
        "issues": dict(sorted(problems.items())),
        "counts": counts,
        "has_financial_records": any(counts[k] for k in ("accounts", "cards", "transactions")),
        "total_account_balance": float(quantize_brl(total_balance)) if not problems else None,
        "legacy_reconciliation": "not_verified",
        "historical_invoices": review_historical_invoices(
            records["cards"], records["transactions"], today_iso()
        ),
    }
