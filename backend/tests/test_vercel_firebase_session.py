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
    assert config["routes"][0]["dest"] == "/api"
    import re
    for path in ["/api/auth/me", "/api/accounts", "/api/transactions/id", "/api/dashboard"]:
        assert re.fullmatch(config["routes"][0]["src"], path)
    assert config["routes"][-1]["src"] == "/(?!api(?:/|$)).*"


@pytest.fixture
def smoke(client, firebase, monkeypatch):
    monkeypatch.setenv("FIREBASE_LIVE_SMOKE", "1")
    client.cookies.set(api.COOKIE, "signed-firebase-session")
    from firebase_admin import firestore
    doc = Mock()
    doc.get.side_effect = [
        SimpleNamespace(exists=True, to_dict=lambda: {"nonce": doc.create.call_args.args[0]["nonce"]}),
        SimpleNamespace(exists=False),
    ]
    collection = Mock()
    collection.document.return_value = doc
    db = Mock(project="finnos-app")
    db.collection.return_value = collection
    monkeypatch.setattr(firestore, "client", Mock(return_value=db))
    return db, collection, doc


@pytest.mark.parametrize("environment", ["production", "development", "staging", ""])
def test_smoke_never_runs_outside_preview(client, smoke, monkeypatch, environment):
    monkeypatch.setenv("VERCEL_ENV", environment)
    response = client.post("/api/auth/firestore-smoke", headers={"Origin": "https://preview.example.com"})
    assert response.status_code == 404
    smoke[0].collection.assert_not_called()


def test_smoke_requires_opt_in(client, smoke, monkeypatch):
    monkeypatch.delenv("FIREBASE_LIVE_SMOKE")
    assert client.get("/api/auth/firestore-smoke").status_code == 404
    assert client.post("/api/auth/firestore-smoke", headers={"Origin": "https://preview.example.com"}).status_code == 404
    smoke[0].collection.assert_not_called()


def test_smoke_requires_verified_session_and_origin(client, smoke, firebase):
    assert client.post("/api/auth/firestore-smoke", headers={"Origin": "https://evil.example"}).status_code == 403
    client.cookies.clear()
    assert client.get("/api/auth/firestore-smoke").status_code == 401
    assert client.post("/api/auth/firestore-smoke", headers={"Origin": "https://preview.example.com"}).status_code == 401
    smoke[0].collection.assert_not_called()


def test_smoke_get_is_read_only_and_post_cleans_up(client, smoke):
    assert client.get("/api/auth/firestore-smoke").status_code == 200
    smoke[0].collection.assert_not_called()
    response = client.post("/api/auth/firestore-smoke", headers={"Origin": "https://preview.example.com"})
    assert response.status_code == 200 and "APROVADO" in response.text
    assert "no-store" in response.headers["cache-control"]
    smoke[0].collection.assert_called_once_with("_migration_smoke")
    assert smoke[1].document.call_args.args[0].startswith("smoke-")
    smoke[2].create.assert_called_once()
    smoke[2].delete.assert_called_once_with(timeout=10)
    assert smoke[2].get.call_count == 2


def test_smoke_rejects_wrong_project_before_write(client, smoke):
    smoke[0].project = "other-project"
    assert client.post("/api/auth/firestore-smoke", headers={"Origin": "https://preview.example.com"}).status_code == 503
    smoke[0].collection.assert_not_called()


def test_smoke_cleans_up_after_read_failure_without_leaking_details(client, smoke):
    from google.api_core.exceptions import PermissionDenied
    smoke[2].get.side_effect = PermissionDenied("private-detail")
    response = client.post("/api/auth/firestore-smoke", headers={"Origin": "https://preview.example.com"})
    assert response.status_code == 503 and "private-detail" not in response.text
    smoke[2].delete.assert_called_once_with(timeout=10)


def test_smoke_does_not_approve_failed_cleanup(client, smoke):
    from google.api_core.exceptions import PermissionDenied
    smoke[2].delete.side_effect = PermissionDenied("private-detail")
    response = client.post("/api/auth/firestore-smoke", headers={"Origin": "https://preview.example.com"})
    assert response.status_code == 503 and "APROVADO" not in response.text
