"""Deterministic, non-persisting natural-language draft extraction for FIINT.

No LLM, OCR, or audio is claimed. Ambiguous fields remain unset and must be
confirmed by the user before the existing transaction creation API is called.
"""
import re
from datetime import date
from decimal import Decimal, InvalidOperation

AMOUNT = re.compile(r"(?<![\w])(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\w])", re.I)
TRANSFER = re.compile(r"\b(transferi|transfer[eê]ncia|enviei|mandei|pix\s+para)\b", re.I)
INCOME = re.compile(r"\b(recebi|ganhei|sal[aá]rio|pagamento\s+recebido|rendimento)\b", re.I)
EXPENSE = re.compile(r"\b(gastei|paguei|comprei|despesa|compra)\b", re.I)


def parse_amount(text: str):
    matches = list(AMOUNT.finditer(text))
    for match in matches:
        raw = match.group(1)
        if "." in raw and "," in raw:
            raw = raw.replace(".", "").replace(",", ".")
        elif "," in raw:
            raw = raw.replace(",", ".")
        try:
            value = Decimal(raw)
        except InvalidOperation:
            continue
        if value > 0 and value <= Decimal("1000000000"):
            return float(value)
    return None


def interpret(text: str, *, today: date, accounts: list[dict], categories: list[dict]) -> dict:
    clean = " ".join(text.strip().split())
    if not clean or len(clean) > 1000:
        raise ValueError("Descreva o lançamento em até 1.000 caracteres.")
    tx_type = ("transferencia" if TRANSFER.search(clean) else
               "receita" if INCOME.search(clean) else
               "despesa" if EXPENSE.search(clean) else None)
    amount = parse_amount(clean)
    account_matches = [a for a in accounts if a.get("name") and re.search(
        r"(?<!\w)" + re.escape(a["name"]) + r"(?!\w)", clean, re.I)]
    account_id = account_matches[0]["id"] if len(account_matches) == 1 else None
    hints = {"padaria": "aliment", "mercado": "aliment", "supermercado": "aliment",
             "farmácia": "saúde", "farmacia": "saúde", "uber": "transporte"}
    category_id = None
    if tx_type == "despesa":
        for keyword, category_hint in hints.items():
            if keyword in clean.lower():
                matches = [c for c in categories if category_hint in c.get("name", "").lower()]
                if len(matches) == 1:
                    category_id = matches[0]["id"]
                break
    missing = []
    if tx_type is None:
        missing.append("type")
    if amount is None:
        missing.append("value")
    if account_id is None:
        missing.append("account_id")
    if tx_type == "transferencia":
        missing.append("to_account_id")
    return {
        "type": tx_type, "value": amount, "name": clean,
        "date": today.isoformat() if re.search(r"\bhoje\b", clean, re.I) else None,
        "account_id": account_id, "to_account_id": None,
        "category_id": category_id, "missing_fields": missing,
        "requires_confirmation": True, "source": "fiint_text_rules_v1",
    }
