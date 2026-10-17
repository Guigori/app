"""Conservative bank-name comparison; NEVER apply bank aliases automatically."""
import re
import unicodedata


def institution_key(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    return re.sub(r"\s+", " ", text).strip().casefold()
