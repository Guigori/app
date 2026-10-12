from fastapi import HTTPException, Request
from finnos.lib.db import active_uid

verify = None
COOKIE = "finnos_firebase_session"


async def require_user(request: Request):
    cookie = request.cookies.get(COOKIE)
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and token.strip():
        claims = verify(token.strip(), session=False)
    elif cookie:
        claims = verify(cookie, session=True)
    else:
        raise HTTPException(401, "Não autenticado.")
    uid = claims["uid"]
    if "/" in uid or len(uid) > 128:
        raise HTTPException(401, "Identidade inválida.")
    if (
        request.headers.get("x-finnos-user-id")
        and request.headers["x-finnos-user-id"] != uid
    ):
        raise HTTPException(401, "A identidade da sessão mudou.")
    active_uid.set(uid)
    return {"id": uid, "email": claims["email"]}
