"""Firebase bearer authentication for new FINNOS API routes.

Legacy cookie sessions remain unchanged until all consumers migrate.
Financial routes must derive identity from the verified token, never request bodies.
"""
from fastapi import Depends, HTTPException, Request, status
from firebase_admin import auth as firebase_auth

from lib.firebase import verify_id_token


def firebase_identity(request: Request) -> dict:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token Firebase ausente.")
    try:
        claims = verify_id_token(token.strip())
    except (ValueError, firebase_auth.InvalidIdTokenError,
            firebase_auth.ExpiredIdTokenError,
            firebase_auth.RevokedIdTokenError,
            firebase_auth.UserDisabledError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida ou expirada.") from exc
    uid = claims.get("uid")
    if not isinstance(uid, str) or not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identidade Firebase inválida.")
    return {"id": uid, "uid": uid, "email": claims.get("email"),
            "email_verified": claims.get("email_verified", False)}


def require_verified_firebase_user(identity: dict = Depends(firebase_identity)) -> dict:
    if not identity["email_verified"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Confirme seu e-mail para continuar.")
    return identity
