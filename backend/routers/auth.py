"""Auth: signup with e-mail confirmation code, login, logout, me.

Signup creates an unverified user and e-mails a 6-digit code; the session only
opens after the code is confirmed. Sessions are httpOnly cookies, never JSON tokens.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from passlib.context import CryptContext

from lib.db import db
from lib.demo_data import insert_default_categories
from lib.email import send_email, verification_code_html
from lib.stats import aware
from models.auth import (
    LoginIn,
    NameUpdateIn,
    ResendCodeIn,
    SignupIn,
    SignupOut,
    UserOut,
    VerifyEmailIn,
)

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["pbkdf2_sha256"])
SESSION_COOKIE = "finnos_session"
SESSION_TTL = timedelta(days=30)
CODE_TTL = timedelta(minutes=15)
MAX_CODE_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def require_user(request: Request) -> dict:
    """Dependency: the signed-in (and verified) user, or 401."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        session = await db.sessions.find_one({"token": token, "expires_at": {"$gte": _now()}})
        if session:
            user = await db.users.find_one({"id": session["user_id"]})
            if user and user.get("email_verified"):
                return user
    raise HTTPException(status_code=401, detail="Não autenticado. Entre novamente.")


def _user_out(doc: dict) -> UserOut:
    return UserOut(
        id=doc["id"],
        name=doc["name"],
        email=doc["email"],
        created_at=aware(doc.get("created_at")) or _now(),
    )


async def _open_session(response: Response, user_id: str) -> None:
    token = str(uuid.uuid4())
    await db.sessions.insert_one(
        {"token": token, "user_id": user_id, "created_at": _now(), "expires_at": _now() + SESSION_TTL}
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        path="/",
    )


async def _issue_code(user: dict) -> None:
    """Store a fresh hashed code and e-mail it. The plaintext code only lives in the e-mail."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "verification_code_hash": pwd_context.hash(code),
                "verification_expires_at": _now() + CODE_TTL,
                "verification_attempts": 0,
                "verification_sent_at": _now(),
            }
        },
    )
    await send_email(
        to=user["email"],
        subject="Seu código de confirmação FINNOS",
        html=verification_code_html(name=user["name"], code=code),
    )


@router.post("/signup", response_model=SignupOut, status_code=202)
async def signup(payload: SignupIn) -> SignupOut:
    email = payload.email.strip().lower()
    existing = await db.users.find_one({"email": email})
    if existing and existing.get("email_verified"):
        raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.")

    if existing:
        # Unverified signup attempt: refresh credentials and send a new code.
        await db.users.update_one(
            {"id": existing["id"]},
            {"$set": {"name": payload.name.strip(), "password_hash": pwd_context.hash(payload.password)}},
        )
        user = {**existing, "name": payload.name.strip()}
    else:
        user = {
            "id": str(uuid.uuid4()),
            "name": payload.name.strip(),
            "email": email,
            "password_hash": pwd_context.hash(payload.password),
            "email_verified": False,
            "created_at": _now(),
        }
        await db.users.insert_one(user)

    await _issue_code(user)
    return SignupOut(email=email)


@router.post("/verify-email", response_model=UserOut)
async def verify_email(payload: VerifyEmailIn, response: Response) -> UserOut:
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="Nenhum cadastro encontrado para este e-mail.")
    if user.get("email_verified"):
        raise HTTPException(status_code=409, detail="Este e-mail já foi confirmado. Faça login.")

    expires = aware(user.get("verification_expires_at"))
    if not user.get("verification_code_hash") or not expires or expires < _now():
        raise HTTPException(status_code=410, detail="O código expirou. Peça um novo código.")
    if int(user.get("verification_attempts") or 0) >= MAX_CODE_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Peça um novo código.")

    if not pwd_context.verify(payload.code, user["verification_code_hash"]):
        await db.users.update_one({"id": user["id"]}, {"$inc": {"verification_attempts": 1}})
        raise HTTPException(status_code=400, detail="Código incorreto. Confira o e-mail e tente novamente.")

    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {"email_verified": True, "verified_at": _now()},
            "$unset": {
                "verification_code_hash": "",
                "verification_expires_at": "",
                "verification_attempts": "",
            },
        },
    )
    if not await db.categories.count_documents({"user_id": user["id"]}):
        await insert_default_categories(user["id"])
    await _open_session(response, user["id"])
    return _user_out(user)


@router.post("/resend-code", response_model=SignupOut)
async def resend_code(payload: ResendCodeIn) -> SignupOut:
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="Nenhum cadastro encontrado para este e-mail.")
    if user.get("email_verified"):
        raise HTTPException(status_code=409, detail="Este e-mail já foi confirmado. Faça login.")

    sent_at = aware(user.get("verification_sent_at"))
    if sent_at and _now() - sent_at < RESEND_COOLDOWN:
        wait = int((RESEND_COOLDOWN - (_now() - sent_at)).total_seconds()) + 1
        raise HTTPException(status_code=429, detail=f"Aguarde {wait}s para pedir um novo código.")

    await _issue_code(user)
    return SignupOut(email=email)


@router.post("/login", response_model=UserOut)
async def login(payload: LoginIn, response: Response) -> UserOut:
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email})
    if not user or not pwd_context.verify(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
    if not user.get("email_verified"):
        raise HTTPException(
            status_code=403, detail="Confirme seu e-mail para entrar. Podemos enviar um novo código."
        )
    await _open_session(response, user["id"])
    return _user_out(user)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db.sessions.delete_one({"token": token})
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(require_user)) -> UserOut:
    return _user_out(user)


@router.patch("/me", response_model=UserOut)
async def update_name(payload: NameUpdateIn, user: dict = Depends(require_user)) -> UserOut:
    await db.users.update_one({"id": user["id"]}, {"$set": {"name": payload.name, "updated_at": _now()}})
    user["name"] = payload.name
    return _user_out(user)
