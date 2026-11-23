"""Beta access: public waitlist, invite list, feedback and app error reports.

Everything here lives in root collections that hold no financial data, managed in
the Firebase console (Firestore), not in the app:
  beta_waitlist   people who asked for an invite; document ID = e-mail
  beta_access     e-mails allowed in while the beta is invite-only; document ID = e-mail
  beta_feedback   messages sent from the app
  beta_errors     app errors, grouped by fingerprint

To let someone in: Firestore > beta_access > Add document, Document ID = the e-mail
in lower case (no fields needed). Deleting that document removes the access.

The invite gate is off unless FINNOS_INVITE_ONLY=1. People who already use FINNOS
are never locked out: anyone with an account in Firestore passes.
"""

import hashlib
import os
import re
import time
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store

router = APIRouter(tags=["access"])

WAITLIST = "beta_waitlist"
ACCESS = "beta_access"
FEEDBACK = "beta_feedback"
ERRORS = "beta_errors"
INVITE_DETAIL = "convite"
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")

# Process-wide caches: a warm function answers the gate without reading Firestore.
_allowed: dict[str, float] = {}
_denied: dict[str, float] = {}
_hits: dict[str, list[float]] = {}
ALLOWED_TTL = 15 * 60
DENIED_TTL = 60


def now():
    return datetime.now(timezone.utc)


def norm_email(value: str) -> str:
    return (value or "").strip().lower()


def email_key(value: str) -> str:
    """Documents are keyed by the e-mail itself so they can be added by hand in the console."""
    key = norm_email(value)
    if not key or "/" in key or key in {".", ".."} or len(key) > 254:
        raise HTTPException(422, "Confira o e-mail.")
    return key


def invite_only() -> bool:
    return os.getenv("FINNOS_INVITE_ONLY") == "1"


def _db():
    return store.client()


def rate_limited(key: str, limit: int, window: int) -> bool:
    moment = time.time()
    recent = [t for t in _hits.get(key, []) if moment - t < window]
    recent.append(moment)
    _hits[key] = recent[-limit * 2:]
    if len(_hits) > 5000:
        _hits.clear()
    return len(recent) > limit


def _has_access(uid: str, email: str) -> bool:
    client = _db()
    if client.collection(ACCESS).document(email_key(email)).get().exists:
        return True
    # Existing users keep their access when the gate is turned on.
    owner = store.root(client, uid)
    for name in ("accounts", "transactions", "onboarding"):
        if list(owner.collection(name).limit(1).stream()):
            return True
    return False


def check_access(uid: str, email: str) -> None:
    """Raises 403 "convite" when the beta is invite-only and this person is not in."""
    if not invite_only():
        return
    moment = time.time()
    if _allowed.get(uid, 0) > moment:
        return
    if _denied.get(uid, 0) > moment:
        raise HTTPException(403, INVITE_DETAIL)
    if _has_access(uid, email):
        _allowed[uid] = moment + ALLOWED_TTL
        return
    _denied[uid] = moment + DENIED_TTL
    raise HTTPException(403, INVITE_DETAIL)


def forget(uid: str | None = None) -> None:
    if uid:
        _allowed.pop(uid, None)
        _denied.pop(uid, None)
    else:
        _allowed.clear()
        _denied.clear()


def client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or (
        request.client.host if request.client else "?")


# --- Public: ask for an invite -------------------------------------------------

class WaitlistIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=8, max_length=24)
    email: str = Field(min_length=5, max_length=254)
    consent: bool
    website: Optional[str] = Field(default="", max_length=200)  # honeypot: people never see it
    source: Optional[str] = Field(default=None, max_length=40)


@router.post("/public/waitlist")
async def join_waitlist(payload: WaitlistIn, request: Request):
    if payload.website:
        return {"ok": True}  # a bot filled the hidden field: answer as usual, store nothing
    if rate_limited("w:" + client_ip(request), 5, 3600):
        raise HTTPException(429, "Muitos pedidos deste aparelho. Tente de novo mais tarde.")
    if not payload.consent:
        raise HTTPException(422, "Confirme que podemos entrar em contato.")
    email = norm_email(payload.email)
    if not EMAIL.match(email):
        raise HTTPException(422, "Confira o e-mail.")
    digits = re.sub(r"\D", "", payload.phone)
    if not 10 <= len(digits) <= 13:
        raise HTTPException(422, "Confira o telefone com DDD.")
    name = " ".join(payload.name.split())

    def write():
        ref = _db().collection(WAITLIST).document(email_key(email))
        snap = ref.get()
        data = {"name": name, "phone": digits, "email": email, "consent": True,
                "source": (payload.source or "")[:40], "updated_at": now()}
        if snap.exists:
            ref.set(data, merge=True)
            return False
        ref.set({**data, "liberado": False, "created_at": now()})
        return True

    created = await run_in_threadpool(write)
    return {"ok": True, "created": created}


# --- Signed-in people: feedback and error reports ----------------------------

def _user_dep():
    from finnos.routers.auth import require_user
    return require_user


class FeedbackIn(BaseModel):
    kind: Literal["bug", "ideia", "elogio", "duvida", "outro"]
    message: str = Field(min_length=3, max_length=2000)
    screen: Optional[str] = Field(default=None, max_length=120)
    version: Optional[str] = Field(default=None, max_length=60)
    device: Optional[str] = Field(default=None, max_length=200)
    mood: Optional[int] = Field(default=None, ge=1, le=5)


@router.post("/feedback")
async def send_feedback(payload: FeedbackIn, user: dict = Depends(_user_dep())):
    if rate_limited("f:" + user["id"], 10, 3600):
        raise HTTPException(429, "Você já mandou várias mensagens agora. Tente daqui a pouco.")
    doc = {
        "uid": user["id"], "email": user.get("email"), "kind": payload.kind,
        "message": payload.message.strip(), "screen": (payload.screen or "").split("?")[0],
        "version": payload.version, "device": payload.device, "mood": payload.mood,
        "status": "novo", "created_at": now(),
    }
    ref = await run_in_threadpool(lambda: _db().collection(FEEDBACK).add(doc))
    return {"ok": True, "id": ref[1].id if isinstance(ref, tuple) else None}


class ClientErrorIn(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    stack: Optional[str] = Field(default=None, max_length=4000)
    screen: Optional[str] = Field(default=None, max_length=120)
    kind: Literal["error", "rejection", "render", "api"] = "error"
    version: Optional[str] = Field(default=None, max_length=60)
    device: Optional[str] = Field(default=None, max_length=200)


def fingerprint(message: str, stack: str | None) -> str:
    # Group by the message without numbers plus the first stack frame.
    head = re.sub(r"\d+", "#", message)[:200]
    frame = next((line.strip() for line in (stack or "").splitlines()[1:] if line.strip()), "")
    # Drop line:column so a new build of the same code keeps the same group.
    frame = re.sub(r":\d{1,7}:\d{1,7}", "", frame[:300])[:200]
    return hashlib.sha256((head + "|" + frame).encode()).hexdigest()[:32]


@router.post("/client-errors")
async def report_error(payload: ClientErrorIn, user: dict = Depends(_user_dep())):
    if rate_limited("e:" + user["id"], 30, 3600):
        return {"ok": True, "skipped": True}
    key = fingerprint(payload.message, payload.stack)
    screen = (payload.screen or "").split("?")[0]

    def write():
        from firebase_admin import firestore
        ref = _db().collection(ERRORS).document(key)
        snap = ref.get()
        if snap.exists:
            current = snap.to_dict() or {}
            users = list(dict.fromkeys([*(current.get("users") or []), user["id"]]))[-20:]
            ref.set({"count": firestore.Increment(1), "last_seen": now(), "users": users,
                     "user_count": len(users), "last_screen": screen, "version": payload.version,
                     "status": "aberto" if current.get("status") == "resolvido" else current.get("status", "aberto")},
                    merge=True)
        else:
            ref.set({"message": payload.message, "stack": payload.stack, "kind": payload.kind,
                     "first_screen": screen, "last_screen": screen, "version": payload.version,
                     "device": payload.device, "count": 1, "users": [user["id"]], "user_count": 1,
                     "status": "aberto", "first_seen": now(), "last_seen": now()})

    await run_in_threadpool(write)
    return {"ok": True}
