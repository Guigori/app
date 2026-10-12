"""Preview-only Firebase auth API, deliberately independent of the Mongo backend.

Vercel's project root is frontend/. Importing backend/server.py would require
Mongo credentials and run its index-creation lifespan. This entrypoint never
imports that server or touches MongoDB. Financial routes use UID-scoped Firestore subcollections. The diagnostic uses
a temporary _migration_smoke document. Firestore rules stay unchanged.
"""
import json
import os
import time
from datetime import timedelta, datetime, timezone
from urllib.parse import urlparse

import firebase_admin
from firebase_admin import auth, credentials, exceptions
from fastapi import Depends, FastAPI, HTTPException, Request, Response

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
COOKIE = "finnos_firebase_session"
TTL = timedelta(days=5)


@app.middleware("http")
async def preview_only(request: Request, call_next):
    # Fail closed outside the explicitly selected preview or local test runtime.
    if os.getenv("VERCEL_ENV", "development") not in {"preview", "development"}:
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Not found"}, status_code=404)
    response = await call_next(request)
    response.headers["Cache-Control"] = "private, no-store"
    return response


def firebase_app():
    try:
        return firebase_admin.get_app("finnos-preview-auth")
    except ValueError:
        raw = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
        if not raw:
            raise HTTPException(503, "Credencial Firebase Admin ausente no Preview.")
        try:
            payload = json.loads(raw)
            expected = os.getenv("FIREBASE_PROJECT_ID")
            if expected and payload.get("project_id") != expected:
                raise ValueError("Project mismatch")
            credential = credentials.Certificate(payload)
            return firebase_admin.initialize_app(credential, name="finnos-preview-auth")
        except (ValueError, TypeError, KeyError) as exc:
            raise HTTPException(503, "Configuração Firebase Admin inválida no Preview.") from exc


def same_origin(request: Request):
    origin = urlparse(request.headers.get("origin", ""))
    local = os.getenv("VERCEL_ENV", "development") == "development"
    allowed_schemes = {"https", "http"} if local else {"https"}
    if (origin.scheme not in allowed_schemes or origin.netloc != request.headers.get("host")
            or origin.path or origin.query or origin.fragment):
        raise HTTPException(403, "Origem da requisição inválida.")


def verified_claims(token: str, *, session=False):
    verifier = auth.verify_session_cookie if session else auth.verify_id_token
    try:
        claims = verifier(token, app=firebase_app(), check_revoked=True)
    except (ValueError, auth.InvalidIdTokenError, auth.InvalidSessionCookieError,
            auth.ExpiredIdTokenError, auth.ExpiredSessionCookieError,
            auth.RevokedIdTokenError, auth.RevokedSessionCookieError,
            auth.UserDisabledError) as exc:
        raise HTTPException(401, "Sessão Firebase inválida ou expirada.") from exc
    except exceptions.FirebaseError as exc:
        raise HTTPException(503, "Firebase indisponível. Tente novamente.") from exc
    if not isinstance(claims.get("uid"), str) or not claims["uid"]:
        raise HTTPException(401, "Identidade Firebase inválida.")
    if not claims.get("email_verified") or not claims.get("email"):
        raise HTTPException(403, "Confirme seu e-mail para continuar.")
    return claims


def user_out(claims):
    try:
        user = auth.get_user(claims["uid"], app=firebase_app())
    except auth.UserNotFoundError as exc:
        raise HTTPException(401, "Conta Firebase não encontrada.") from exc
    except exceptions.FirebaseError as exc:
        raise HTTPException(503, "Firebase indisponível. Tente novamente.") from exc
    if user.disabled or not user.email_verified:
        raise HTTPException(403, "Conta Firebase indisponível ou não confirmada.")
    return {
        "id": user.uid,
        "name": user.display_name or user.email.split("@")[0],
        "email": user.email,
        "created_at": datetime.fromtimestamp(
            user.user_metadata.creation_timestamp / 1000, timezone.utc
        ).isoformat(),
    }


@app.post("/api/auth/firebase-session", dependencies=[Depends(same_origin)])
def firebase_session(request: Request, response: Response):
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Token Firebase ausente.")
    claims = verified_claims(token.strip())
    auth_time = claims.get("auth_time")
    if not isinstance(auth_time, (int, float)) or not 0 <= time.time() - auth_time <= 300:
        raise HTTPException(401, "Entre novamente com Google para iniciar a sessão.")
    user = user_out(claims)
    try:
        cookie = auth.create_session_cookie(token.strip(), expires_in=TTL, app=firebase_app())
    except exceptions.FirebaseError as exc:
        raise HTTPException(503, "Não foi possível iniciar a sessão Firebase.") from exc
    response.set_cookie(COOKIE, cookie, max_age=int(TTL.total_seconds()),
                        httponly=True, secure=os.getenv("VERCEL_ENV") == "preview",
                        samesite="lax", path="/")
    return user


@app.get("/api/auth/me")
def me(request: Request):
    cookie = request.cookies.get(COOKIE)
    if not cookie:
        raise HTTPException(401, "Não autenticado. Entre novamente.")
    return user_out(verified_claims(cookie, session=True))


@app.post("/api/auth/logout", status_code=204, dependencies=[Depends(same_origin)])
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/", httponly=True,
                           secure=os.getenv("VERCEL_ENV") == "preview", samesite="lax")


# Diagnostic is explicitly opt-in, Preview-only, and uses no Mongo imports.
def smoke_claims(request: Request):
    if os.getenv("VERCEL_ENV") != "preview" or os.getenv("FIREBASE_LIVE_SMOKE") != "1":
        raise HTTPException(404, "Not found")
    cookie = request.cookies.get(COOKIE)
    if not cookie:
        raise HTTPException(401, "Não autenticado. Entre novamente.")
    return verified_claims(cookie, session=True)


def smoke_page(message: str, *, status_code=200, form=False):
    from fastapi.responses import HTMLResponse
    from html import escape
    content = '<form method="post"><button type="submit">Executar teste isolado do Firestore</button></form>' if form else ""
    response = HTMLResponse(
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>FINNOS — Diagnóstico Firestore Preview</title>'
        '<body><main><h1>FINNOS — Diagnóstico Firestore Preview</h1><p>'
        + escape(message) + '</p>' + content
        + '<p><a href="/">Voltar ao FINNOS</a></p></main></body></html>',
        status_code=status_code,
    )
    response.headers["Content-Security-Policy"] = "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/auth/firestore-smoke")
def firestore_smoke_form(request: Request):
    smoke_claims(request)
    return smoke_page(
        "Teste exclusivo do Preview: cria um documento aleatório em _migration_smoke, "
        "confere a leitura e remove o documento. Não acessa dados financeiros nem MongoDB.",
        form=True,
    )


@app.post("/api/auth/firestore-smoke", dependencies=[Depends(same_origin)])
def firestore_smoke(request: Request):
    smoke_claims(request)
    from firebase_admin import firestore
    from google.api_core.exceptions import GoogleAPICallError
    from uuid import uuid4
    client = firestore.client(app=firebase_app())
    if client.project != "finnos-app":
        raise HTTPException(503, "Projeto Firestore inesperado; teste não executado.")
    doc_id = "smoke-" + str(uuid4())
    ref = client.collection("_migration_smoke").document(doc_id)
    payload = {"source": "finnos-preview-diagnostic", "nonce": doc_id,
               "created_at": datetime.now(timezone.utc)}
    try:
        try:
            ref.create(payload, timeout=10)
            snapshot = ref.get(timeout=10)
            if not snapshot.exists or snapshot.to_dict().get("nonce") != doc_id:
                raise RuntimeError("Firestore read-back mismatch")
        finally:
            # The unique random reference is the only document touched.
            # Also clean up if a timed-out create reached the server.
            ref.delete(timeout=10)
        if ref.get(timeout=10).exists:
            raise RuntimeError("Firestore cleanup mismatch")
    except (GoogleAPICallError, RuntimeError):
        return smoke_page(
            "Teste Firestore falhou. A limpeza do documento temporário foi tentada. "
            "Confira os logs do Preview; o resultado não foi aprovado.", status_code=503,
        )
    return smoke_page(
        "APROVADO — projeto finnos-app. Escrita: OK. Leitura: OK. "
        "Exclusão: OK. Ausência do documento após a limpeza: confirmada. "
        "MongoDB e dados financeiros não foram acessados."
    )


from finnos.routes import mount
mount(app, lambda: firebase_app(), lambda *args, **kwargs: verified_claims(*args, **kwargs), same_origin)
from finnos.validation import mount_validation
mount_validation(app, lambda: firebase_app(), lambda *args, **kwargs: verified_claims(*args, **kwargs), same_origin)
