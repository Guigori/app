"""Deterministic, non-persisting natural-language draft extraction for FIINT.

No LLM, OCR, or audio is claimed. Ambiguous fields remain unset and must be
confirmed by the user before the existing transaction creation API is called.
"""
import re
from lib.fiint.registration_helpers import amount_from_text, date_from_text, accounts_from_text, installments_from_text
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
    amount = amount_from_text(clean)
    account_id, to_account_id = accounts_from_text(clean, accounts, tx_type == "transferencia")
    installment, total_installments = installments_from_text(clean)
    if tx_type != "despesa":
        installment, total_installments = False, None
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
    if tx_type == "transferencia" and to_account_id is None:
        missing.append("to_account_id")
    return {
        "type": tx_type, "value": amount, "name": clean,
        "date": today.isoformat() if re.search(r"\bhoje\b", clean, re.I) else None,
        "account_id": account_id, "to_account_id": to_account_id,
        "installment": installment, "total_installments": total_installments,
        "category_id": category_id, "missing_fields": missing,
        "requires_confirmation": True, "source": "fiint_text_rules_v2",
    }
