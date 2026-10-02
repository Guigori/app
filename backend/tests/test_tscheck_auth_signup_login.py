"""Criterion: Cadastro e login funcionam, com rotas protegidas e sessão persistente."""
import uuid

import pytest


def _unique_email():
    return f"tscheck-auth-{uuid.uuid4().hex[:10]}@finnos.app"


def test_signup_creates_user_and_session(client):
    email = _unique_email()
    resp = client.post(
        "/auth/signup",
        json={"name": "Tscheck User", "email": email, "password": "senha123"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Tscheck User"
    assert body["email"] == email
    assert "finnos_session" in resp.cookies

    # session cookie grants access to /auth/me
    me = client.get("/auth/me", cookies=resp.cookies)
    assert me.status_code == 200
    assert me.json()["email"] == email


def test_signup_duplicate_email_returns_readable_error(client):
    email = _unique_email()
    first = client.post(
        "/auth/signup",
        json={"name": "Tscheck Dup", "email": email, "password": "senha123"},
    )
    assert first.status_code == 200

    dup = client.post(
        "/auth/signup",
        json={"name": "Tscheck Dup2", "email": email, "password": "senha123"},
    )
    assert dup.status_code in (400, 409), dup.text
    detail = dup.json().get("detail", "")
    assert isinstance(detail, str) and len(detail) > 0
    # must be a readable message, not a stack trace / generic error
    assert "traceback" not in detail.lower()


def test_login_demo_account_and_protected_route_without_session(client):
    login = client.post(
        "/auth/login", json={"email": "demo@finnos.app", "password": "demo1234"}
    )
    assert login.status_code == 200, login.text
    assert login.json()["name"] == "Demo FINNOS"
    assert "finnos_session" in login.cookies

    # no cookie -> protected route rejects
    unauth = client.get("/auth/me")
    assert unauth.status_code == 401
