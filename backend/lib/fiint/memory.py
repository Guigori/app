"""User-scoped merchant category memory for confirmed FIINT corrections.

No cross-user learning. Memory is explicit, deterministic and reversible.
"""
import re
import unicodedata


def merchant_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    ascii_text = "".join(c for c in normalized if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9]+", ascii_text))[:80]


def learned_category(text: str, memories: list[dict], valid_categories: list[dict]):
    valid = {str(c["id"]) for c in valid_categories}
    normalized = merchant_key(text)
    matches = []
    for memory in memories:
        key = merchant_key(memory.get("merchant", ""))
        category_id = str(memory.get("category_id", ""))
        if key and category_id in valid and re.search(r"(?<!\w)" + re.escape(key) + r"(?!\w)", normalized):
            matches.append((len(key), category_id))
    if not matches:
        return None
    matches.sort(reverse=True)
    if len(matches) > 1 and matches[0][0] == matches[1][0] and matches[0][1] != matches[1][1]:
        return None
    return matches[0][1]
