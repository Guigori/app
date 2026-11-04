"""ARQ-06: Web Push is opt-in, VAPID-configured, UID-scoped and cron authenticated.

No real network, Firebase credential or notifications are used.
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from fastapi import FastAPI

from finnos.lib import push_transport
from finnos.routers import push
from finnos.routers.auth import require_user


def disabled(monkeypatch):
    for name in ("FINNOS_PUSH_ENABLED", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY",
                 "VAPID_SUBJECT", "CRON_SECRET"):
        monkeypatch.delenv(name, raising=False)


def enabled(monkeypatch):
    monkeypatch.setenv("FINNOS_PUSH_ENABLED", "1")
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "synthetic-public")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "synthetic-private")
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:test@example.com")
    monkeypatch.setenv("CRON_SECRET", "synthetic-test-secret-long-enough")


def app_with_user():
    app = FastAPI()
    app.include_router(push.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": "synthetic-user"}
    return app


def test_disabled_push_does_not_advertise_capability_or_accept_registration(monkeypatch):
    disabled(monkeypatch)
    with TestClient(app_with_user()) as client:
        response = client.get("/api/push/public-key")
        assert response.status_code == 200
        assert response.json() == {"public_key": "", "supported": False}
        subscribe = client.post("/api/push/subscribe", json={
            "endpoint": "https://fcm.googleapis.com/fcm/send/synthetic",
            "keys": {"p256dh": "fake", "auth": "fake"},
        })
        assert subscribe.status_code == 503
        assert client.post("/api/push/test").status_code == 503
        assert client.get("/api/push/dispatch").status_code == 401


@pytest.mark.parametrize("bad", [
    "http://fcm.googleapis.com/send/x",
    "https://127.0.0.1/secret",
    "https://fcm.googleapis.com.evil.example/x",
    "https://fcm.googleapis.com:444/x",
    "https://user:pass@fcm.googleapis.com/x",
    "https://localhost/private",
])
def test_push_cannot_be_used_as_ssrf_endpoint(bad):
    with pytest.raises(HTTPException) as error:
        push_transport.gateway(bad)
    assert error.value.status_code == 422


def test_cron_bearer_check_requires_constant_time_authenticated_secret(monkeypatch):
    enabled(monkeypatch)
    for token in (None, "", "Bearer wrong", "synthetic-test-secret-long-enough"):
        with pytest.raises(HTTPException) as error:
            push_transport.require_cron_secret(token)
        assert error.value.status_code == 401
    push_transport.require_cron_secret("Bearer synthetic-test-secret-long-enough")


def test_register_same_uid_and_endpoint_is_idempotent(monkeypatch):
    enabled(monkeypatch)
    saved = {}
    class Registration:
        def __init__(self, key): self.key = key
        def set(self, item): saved[self.key] = dict(item)
        def delete(self): saved.pop(self.key, None)
    monkeypatch.setattr(push, "_registration_collection",
                        lambda: SimpleNamespace(document=lambda key: Registration(key)))
    endpoint = "https://fcm.googleapis.com/fcm/send/synthetic"
    with TestClient(app_with_user()) as client:
        for _ in range(2):
            result = client.post("/api/push/subscribe", json={
                "endpoint": endpoint, "keys": {"p256dh": "synthetic", "auth": "synthetic"},
            })
            assert result.status_code == 200, result.text
            assert result.json()["ok"] is True
        assert len(saved) == 1
        assert next(iter(saved.values()))["uid"] == "synthetic-user"
        assert client.delete("/api/push/subscribe", params={"endpoint": endpoint}).status_code == 200
        assert saved == {}


def test_cron_is_never_available_with_only_secret_but_without_vapid(monkeypatch):
    disabled(monkeypatch)
    monkeypatch.setenv("CRON_SECRET", "synthetic-test-secret-long-enough")
    with TestClient(app_with_user()) as client:
        response = client.get("/api/push/dispatch",
                              headers={"authorization": "Bearer synthetic-test-secret-long-enough"})
    assert response.status_code == 503
