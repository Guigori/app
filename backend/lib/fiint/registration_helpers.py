"""Conservative helpers for FIINT registration drafts."""
import re
from calendar import monthrange
from datetime import timedelta
from decimal import Decimal


def amount_from_text(text):
    patterns = (
        r"R\$\s*(\d[\d.]*,\d{1,2}|\d[\d.]*)",
        r"(?<!\w)(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real)\b",
        r"(?<!\w)(\d+(?:[.,]\d{1,2})?)(?!\w)",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.I):
            raw = match.group(1)
            if "," in raw:
                raw = raw.replace(".", "").replace(",", ".")
            elif raw.count(".") == 1 and len(raw.split(".")[1]) == 3:
                raw = raw.replace(".", "")
            try:
                value = Decimal(raw)
                if 0 < value <= 1000000000:
                    return float(value)
            except Exception:
                pass
    return None


def date_from_text(text, today):
    lower = text.lower()
    if re.search(r"\banteontem\b", lower):
        return (today - timedelta(days=2)).isoformat()
    if re.search(r"\bontem\b", lower):
        return (today - timedelta(days=1)).isoformat()
    if re.search(r"\bhoje\b", lower):
        return today.isoformat()
    match = re.search(r"(?<!\d)(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?!\d)", text)
    if match:
        day, month = int(match[1]), int(match[2])
        year = int(match[3]) if match[3] else today.year
        if year < 100:
            year += 2000
        try:
            from datetime import date
            return date(year, month, day).isoformat()
        except ValueError:
            return None
    return None


def accounts_from_text(text, accounts, transfer):
    found = []
    for account in accounts:
        name = account.get("name", "")
        if not name:
            continue
        match = re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", text, re.I)
        if match:
            found.append((match.start(), match.end(), account["id"]))
    found.sort()
    if not transfer:
        return (found[0][2] if len(found) == 1 else None), None
    if len(found) != 2 or found[0][2] == found[1][2]:
        return None, None
    first, second = found
    before_first = text[max(0, first[0]-12):first[0]].lower()
    before_second = text[max(0, second[0]-12):second[0]].lower()
    if re.search(r"\b(?:do|da|de)\s*$", before_first) and re.search(r"\b(?:para|pro|pra|ao|à)\s*$", before_second):
        return first[2], second[2]
    return None, None


def installments_from_text(text):
    match = re.search(r"\b(?:em\s+)?(\d{1,2})\s*(?:x|vezes|parcelas)\b", text, re.I)
    if match and 2 <= int(match[1]) <= 48:
        return True, int(match[1])
    return False, None
