"""Read-only dry-run planner for Module 02 institution grouping.

NO Firestore access, NO updates, NO auth logic, NO automatic bank aliases.
Only pass accounts/cards that have already been scoped to a single verified UID.
This tool intentionally does not manufacture a persistent institution_id.
"""
import re
import unicodedata
from collections import defaultdict
from decimal import Decimal


def normalized_institution(label: object) -> str | None:
    if not isinstance(label, str):
        return None
    value = unicodedata.normalize("NFKC", label)
    value = re.sub(r"\s+", " ", value).strip()
    return value.casefold() or None


def dry_run_institution_groups(accounts: list[dict], cards: list[dict]) -> dict:
    """Plan candidate groups without changing source IDs, values or references.

    Similar names such as Inter and Banco Inter deliberately remain separate.
    Blank institutions remain unassigned and require user review.
    """
    groups: dict[str, dict] = {}
    missing = []
    keys_seen: set[tuple[str, str]] = set()
    for kind, rows in (("accounts", accounts), ("cards", cards)):
        for row in rows:
            identifier = row["id"]
            token = (kind, identifier)
            if token in keys_seen:
                raise ValueError("Identificador duplicado na coleção financeira.")
            keys_seen.add(token)
            key = normalized_institution(row.get("institution"))
            if not key:
                missing.append({"kind": kind, "id": identifier})
                continue
            if key not in groups:
                groups[key] = {
                    "candidate_key": key, "labels": [],
                    "account_ids": [], "card_ids": [],
                }
            group = groups[key]
            label = re.sub(r"\s+", " ", str(row["institution"]).strip())
            if label not in group["labels"]:
                group["labels"].append(label)
            group["account_ids" if kind == "accounts" else "card_ids"].append(identifier)

    total = sum((Decimal(str(row.get("balance", row.get("initial_balance", 0)) or 0))
                 for row in accounts), Decimal(0))
    return {
        "write_operations": 0,
        "account_count": len(accounts),
        "card_count": len(cards),
        "source_account_ids": [r["id"] for r in accounts],
        "source_card_ids": [r["id"] for r in cards],
        "account_balance_total_unchanged": str(total),
        "candidate_groups": [groups[k] for k in sorted(groups)],
        "unassigned": missing,
        "requires_manual_alias_review": True,
        "safe_to_auto_merge_aliases": False,
    }
