"""App nativo (Capacitor): Bearer dispensa a checagem de Origin; cookie continua exigindo."""
import asyncio

import httpx

from api import index as api


def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app), base_url="https://testserver")


def test_cookie_write_from_foreign_origin_is_still_refused(monkeypatch):
    monkeypatch.setenv("VERCEL_ENV", "preview")

    async def check():
        async with _client() as c:
            r = await c.post("/api/accounts", json={}, headers={"Origin": "https://evil.example"}, cookies={"finnos_firebase_session": "x"})
            assert r.status_code == 403
    asyncio.run(check())


def test_bearer_write_passes_origin_check_and_reaches_auth(monkeypatch):
    monkeypatch.setenv("VERCEL_ENV", "preview")

    def reject(token, *, session=False):
        from fastapi import HTTPException
        raise HTTPException(401, "Sessão Firebase inválida ou expirada.")
    monkeypatch.setattr(api, "verified_claims", reject)
    from finnos.routers import auth as auth_router
    monkeypatch.setattr(auth_router, "verify", reject)

    async def check():
        async with _client() as c:
            r = await c.post("/api/accounts", json={}, headers={"Origin": "capacitor://localhost", "Authorization": "Bearer abc"})
            # Passou do CSRF (não é 403) e foi barrado só pela validação do token.
            assert r.status_code == 401
    asyncio.run(check())


def test_cors_preflight_only_for_native_origin():
    async def check():
        async with _client() as c:
            ok = await c.options("/api/accounts", headers={"Origin": "capacitor://localhost", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,x-finnos-user-id"})
            assert ok.status_code == 200
            assert ok.headers["access-control-allow-origin"] == "capacitor://localhost"
            assert "access-control-allow-credentials" not in ok.headers
            bad = await c.options("/api/accounts", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
            assert "access-control-allow-origin" not in bad.headers
    asyncio.run(check())
