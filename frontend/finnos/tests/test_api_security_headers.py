"""FNS-011: API-only browser protections, preserving frontend Firebase auth."""
import asyncio

import httpx

from api.index import app


def test_unauthenticated_finance_api_has_restrictive_security_headers():
    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/api/auth/me")
            assert response.status_code == 401
            assert response.headers["X-Content-Type-Options"] == "nosniff"
            assert response.headers["X-Frame-Options"] == "DENY"
            assert response.headers["Referrer-Policy"] == "no-referrer"
            assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
            assert response.headers["Cache-Control"] == "private, no-store"

            # Browser pages are served by Vite/Vercel. This restrictive
            # API CSP must never be inherited by the frontend's auth UI.
            not_api = await client.get("/")
            assert "Content-Security-Policy" not in not_api.headers
    asyncio.run(check())
