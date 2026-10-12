"""HTTP contracts for the Vercel preview function; no live credentials or databases."""
import importlib.util
import json
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("vercel_firebase_session", ROOT / "frontend/api/index.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("VERCEL_ENV", "preview")
    return TestClient(api.app, base_url="https://preview.example.com")


@pytest.fixture
def firebase(monkeypatch):
    claims = {"uid": "user-a", "email": "test@example.com", "email_verified": True,
              "auth_time": time.time()}
    identity = SimpleNamespace(uid="user-a", email="test@example.com", display_name="Test",
                               disabled=False, email_verified=True,
                               user_metadata=SimpleNamespace(creation_timestamp=1700000000000))
    monkeypatch.setattr(api, "firebase_app", lambda: "app")
    verify = Mock(return_value=claims)
    verify_cookie = Mock(return_value=claims)
    create = Mock(return_value="signed-firebase-session")
    monkeypatch.setattr(api.auth, "verify_id_token", verify)
    monkeypatch.setattr(api.auth, "verify_session_cookie", verify_cookie)
    monkeypatch.setattr(api.auth, "create_session_cookie", create)
    monkeypatch.setattr(api.auth, "get_user", Mock(return_value=identity))
    return claims, verify, verify_cookie, create


def login(client):
    return client.post("/api/auth/firebase-session", headers={
        "Origin": "https://preview.example.com", "Authorization": "Bearer signed-id-token"})


def test_me_without_cookie_is_401_not_404(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.headers["cache-control"] == "private, no-store"


def test_google_session_me_logout_roundtrip(client, firebase):
    response = login(client)
    assert response.status_code == 200
    assert response.json()["id"] == "user-a"
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=lax" in cookie
    firebase[1].assert_called_once_with("signed-id-token", app="app", check_revoked=True)
    assert client.get("/api/auth/me").json() == response.json()
    firebase[2].assert_called_once_with("signed-firebase-session", app="app", check_revoked=True)
    assert client.post("/api/auth/logout", headers={"Origin": "https://preview.example.com"}).status_code == 204
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("environment", ["production", "staging", ""])
def test_auth_function_disabled_outside_preview(client, monkeypatch, environment, firebase):
    monkeypatch.setenv("VERCEL_ENV", environment)
    assert login(client).status_code == 404
    assert client.get("/api/auth/me").status_code == 404
    firebase[1].assert_not_called()
    firebase[3].assert_not_called()


@pytest.mark.parametrize("origin", [None, "https://evil.example", "http://preview.example.com"])
def test_session_rejects_cross_origin(client, firebase, origin):
    headers = {"Authorization": "Bearer signed-id-token"}
    if origin:
        headers["Origin"] = origin
    assert client.post("/api/auth/firebase-session", headers=headers).status_code == 403
    firebase[1].assert_not_called()


def test_unverified_user_cannot_open_session(client, firebase):
    firebase[0]["email_verified"] = False
    assert login(client).status_code == 403
    firebase[3].assert_not_called()


def test_old_authentication_cannot_open_session(client, firebase):
    firebase[0]["auth_time"] = time.time() - 600
    assert login(client).status_code == 401
    firebase[3].assert_not_called()


def test_invalid_token_rejected(client, firebase):
    firebase[1].side_effect = ValueError("secret must not leak")
    response = login(client)
    assert response.status_code == 401
    assert "secret" not in response.text


def test_revoked_session_rejected(client, firebase):
    client.cookies.set(api.COOKIE, "revoked")
    firebase[2].side_effect = api.auth.RevokedSessionCookieError("revoked")
    assert client.get("/api/auth/me").status_code == 401


def test_missing_server_credential_reports_503(client, monkeypatch):
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_JSON", raising=False)
    response = login(client)
    assert response.status_code == 503
    assert "Firebase Admin ausente" in response.text


def test_api_route_maps_to_python_function_and_preserves_spa():
    config = json.loads((ROOT / "frontend/vercel.json").read_text())
    assert config["framework"] == "vite"
    assert config["routes"][0] == {"src": "/api/auth/(me|firebase-session|logout)", "dest": "/api"}
    assert config["routes"][-1]["src"] == "/(?!api(?:/|$)).*"
