"""Firestore's daily quota running out answers 503 quota_exhausted with the reopening time, not a 500."""
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.api_core.exceptions import ResourceExhausted

from finnos.lib import quota


def test_reopens_at_midnight_pacific():
    brt = ZoneInfo("America/Sao_Paulo")
    now = datetime(2026, 11, 15, 23, 59, tzinfo=brt)
    assert quota.reopens_at(now).astimezone(brt).strftime("%Y-%m-%d %H:%M") == "2026-11-16 05:00"
    summer = datetime(2026, 7, 10, 12, 0, tzinfo=brt)
    assert quota.reopens_at(summer).astimezone(brt).strftime("%H:%M") == "04:00"


def _app():
    app = FastAPI()
    quota.install(app)

    @app.get("/direct")
    def direct():
        raise ResourceExhausted("Quota exceeded.")

    @app.get("/wrapped")
    def wrapped():
        try:
            raise ResourceExhausted("Quota exceeded.")
        except ResourceExhausted as exc:
            raise RuntimeError("stream failed") from exc

    @app.get("/other")
    def other():
        raise RuntimeError("boom")

    return app


def test_quota_errors_become_503_with_retry_time():
    client = TestClient(_app(), raise_server_exceptions=False)
    for path in ("/direct", "/wrapped"):
        r = client.get(path)
        assert r.status_code == 503, path
        assert r.json()["code"] == "quota_exhausted"
        assert r.json()["retry_at"].endswith("Z")
        assert int(r.headers["Retry-After"]) >= 60
    assert client.get("/other").status_code == 500
