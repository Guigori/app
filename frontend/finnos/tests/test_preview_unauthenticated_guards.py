"""Preview FastAPI integration contract without a real Firebase identity.

No credentials, Firestore writes, or unauthorised privilege bypass. These
guards must pass before any *separate* authenticated Preview E2E with a
dedicated test UID and synthetic data may run.
"""
from fastapi.testclient import TestClient
from api.index import app


def test_unauthenticated_financial_routes_are_not_spa_fallbacks():
    with TestClient(app) as client:
        for url in (
            "/api/auth/me",
            "/api/accounts",
            "/api/cards",
            "/api/transactions/page?month=2026-10",
            "/api/finance/integrity",
            "/api/finance/history",
        ):
            response = client.get(url)
            assert response.status_code == 401, (url, response.status_code, response.text[:150])
            assert response.headers.get("content-type", "").startswith("application/json")


def test_invoice_reconciliation_requires_login_even_when_body_is_synthetic():
    with TestClient(app) as client:
        response = client.post("/api/finance/reconciliation/preview", json={
            "accounts": [{
                "account_id": "test-only",
                "statement_date": "2026-10-25",
                "statement_balance": "0.00",
            }]
        })
        assert response.status_code == 401
