"""Personal tokens for Apple Shortcuts, and the helpers its API needs.

A Shortcut cannot sign in to Firebase, so it carries a token instead. The token is
shown once, stored only as a SHA-256 hash in the server-only `integration_tokens`
collection (no client rule reaches it), can only list names and create
lançamentos, and is revoked from Configurações at any time. Each use is written
to the user's own `integration_audit` log.
"""
import hashlib
import re
import secrets
import time
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from firebase_admin import firestore

from finnos.lib import db as store

PREFIX = "fns_"
MAX_ACTIVE = 5
# Requests per token per hour: plenty for a person, too few for a script.
RATE_LIMIT = 60
RATE_WINDOW = 3600
# Two sends of the same lançamento inside this window are one lançamento.
DUPLICATE_WINDOW = 120


def new_token() -> str:
    return PREFIX + secrets.token_urlsafe(32)


def token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def looks_like_token(raw: str) -> bool:
    return raw.startswith(PREFIX) and 30 <= len(raw) <= 80 and re.fullmatch(r"[A-Za-z0-9_\-]+", raw) is not None


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().lower()


def parse_amount(value) -> Decimal:
    """35.9, "35,90", "R$ 1.234,56", "R$35,90" → Decimal. Raises 422 otherwise."""
    if isinstance(value, bool):
        raise HTTPException(422, "Valor inválido.")
    if isinstance(value, (int, float, Decimal)):
        amount = Decimal(str(value))
    else:
        text = re.sub(r"[^\d,.\-]", "", str(value or ""))
        if "," in text:
            text = text.replace(".", "").replace(",", ".")
        elif text.count(".") > 1 or re.search(r"\.\d{3}$", text):
            # "1.234" is a thousands separator in pt-BR.
            text = text.replace(".", "")
        try:
            amount = Decimal(text)
        except InvalidOperation:
            raise HTTPException(422, "Valor inválido. Use, por exemplo, 35,90.")
    if amount <= 0 or amount > Decimal("10000000"):
        raise HTTPException(422, "Valor inválido. Use, por exemplo, 35,90.")
    return amount.quantize(Decimal("0.01"))


def resolve(name: str | None, items: list[dict], what: str) -> dict | None:
    """Finds by name ignoring case and accents; "Nubank" also finds "Nubank Ultravioleta"."""
    if not name or not str(name).strip():
        return None
    wanted = normalize(str(name))
    exact = [i for i in items if normalize(i.get("name", "")) == wanted]
    if exact:
        return exact[0]
    partial = [i for i in items if wanted in normalize(i.get("name", "")) or normalize(i.get("name", "")) in wanted]
    if len(partial) == 1:
        return partial[0]
    options = ", ".join(i.get("name", "") for i in items[:8]) or "nenhum cadastrado"
    raise HTTPException(422, f"Não encontrei {what} \"{name}\". Opções: {options}.")


def operation_id(uid: str, payload: dict, now: float | None = None) -> str:
    """Same lançamento sent twice within DUPLICATE_WINDOW → same operation, so it is saved once."""
    bucket = int((now if now is not None else time.time()) // DUPLICATE_WINDOW)
    basis = "|".join(str(payload.get(k) or "") for k in sorted(payload)) + f"|{bucket}"
    return "shortcut:" + hashlib.sha256((uid + "|" + basis).encode()).hexdigest()[:40]


def next_window(start: float, count: int, now: float) -> tuple[float, int]:
    """Counts one more use in the hourly window, or refuses when the window is full."""
    if now - start >= RATE_WINDOW:
        start, count = now, 0
    if count >= RATE_LIMIT:
        raise HTTPException(429, "Muitos registros em pouco tempo. Tente de novo em alguns minutos.")
    return start, count + 1


# --- Firestore: server-only. Tests replace these functions. -----------------

def _tokens(db):
    return db.collection("integration_tokens")


def save_token(uid: str, raw: str, label: str) -> dict:
    db = store.client()
    active = [d for d in _tokens(db).where("uid", "==", uid).stream() if not d.to_dict().get("revoked")]
    if len(active) >= MAX_ACTIVE:
        raise HTTPException(409, f"Você já tem {MAX_ACTIVE} atalhos conectados. Desconecte um antes.")
    doc = {
        "uid": uid, "label": label, "hint": raw[-4:], "revoked": False,
        "created_at": datetime.now(timezone.utc), "last_used_at": None,
        "window_start": 0, "window_count": 0,
    }
    _tokens(db).document(token_hash(raw)).create(doc)
    return {"id": token_hash(raw)[:16], **doc}


def list_tokens(uid: str) -> list[dict]:
    db = store.client()
    rows = [{"id": d.id[:16], **d.to_dict()} for d in _tokens(db).where("uid", "==", uid).stream()]
    return sorted([r for r in rows if not r.get("revoked")], key=lambda r: str(r.get("created_at")), reverse=True)


def revoke_token(uid: str, token_id: str) -> bool:
    db = store.client()
    for d in _tokens(db).where("uid", "==", uid).stream():
        if d.id.startswith(token_id) and len(token_id) == 16 and not d.to_dict().get("revoked"):
            d.reference.update({"revoked": True, "revoked_at": datetime.now(timezone.utc)})
            return True
    return False


def use_token(raw: str, now: float | None = None) -> dict:
    """Checks the token and counts one use against its hourly limit. Returns its record."""
    db = store.client()
    ref = _tokens(db).document(token_hash(raw))
    moment = now if now is not None else time.time()

    @firestore.transactional
    def run(tr):
        snap = ref.get(transaction=tr)
        data = snap.to_dict() if snap.exists else None
        if not data or data.get("revoked"):
            raise HTTPException(401, "Atalho desconectado. Gere um novo código em Configurações → Integrações.")
        start, count = next_window(data.get("window_start", 0), data.get("window_count", 0), moment)
        tr.update(ref, {"window_start": start, "window_count": count, "last_used_at": datetime.now(timezone.utc)})
        return {"id": snap.id[:16], **data}

    return run(db.transaction())


def audit(uid: str, entry: dict) -> None:
    db = store.client()
    store.root(db, uid).collection("integration_audit").add({**entry, "at": datetime.now(timezone.utc)})


def recent_audit(uid: str, limit: int = 20) -> list[dict]:
    db = store.client()
    rows = store.root(db, uid).collection("integration_audit").order_by("at", direction=firestore.Query.DESCENDING).limit(limit).stream()
    return [d.to_dict() for d in rows]
