import re
import unicodedata

def sanitize_id_part(value: str) -> str:
    raw = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii").lower()
    clean = re.sub(r"[^a-z0-9._-]+", "-", raw)
    clean = re.sub(r"-+", "-", clean).strip("-._")
    if not clean:
        raise ValueError("FAC identity component cannot be empty after sanitization")
    return clean

def deterministic_analysis_id(kind: str, subject_type: str, subject_id: str, period: str) -> str:
    parts = map(sanitize_id_part, (kind, subject_type, subject_id, period))
    return "analysis:" + ":".join(parts)

def deterministic_radar_id(kind: str, subject_type: str, subject_id: str, period: str) -> str:
    parts = map(sanitize_id_part, (kind, subject_type, subject_id, period))
    return "radar:" + ":".join(parts)
