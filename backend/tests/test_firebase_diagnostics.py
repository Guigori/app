"""Guardrails for live Firestore diagnostics (no live credentials required)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
from lib.firebase_auth import require_verified_firebase_user
from routers import firebase_diagnostics

def test_diagnostic_disabled_without_preview_opt_in(monkeypatch):
    monkeypatch.delenv("FIREBASE_LIVE_SMOKE", raising=False)
    monkeypatch.setenv("VERCEL_ENV", "preview")
    app = FastAPI()
    app.include_router(firebase_diagnostics.router, prefix="/api")
    app.dependency_overrides[require_verified_firebase_user] = lambda: {
        "uid": "test-user", "email_verified": True
    }
    response = TestClient(app).post("/api/firebase/diagnostics/firestore-smoke")
    assert response.status_code == 404

def test_diagnostic_never_runs_in_production(monkeypatch):
    monkeypatch.setenv("FIREBASE_LIVE_SMOKE", "1")
    monkeypatch.setenv("VERCEL_ENV", "production")
    app = FastAPI()
    app.include_router(firebase_diagnostics.router, prefix="/api")
    app.dependency_overrides[require_verified_firebase_user] = lambda: {
        "uid": "test-user", "email_verified": True
    }
    response = TestClient(app).post("/api/firebase/diagnostics/firestore-smoke")
    assert response.status_code == 404
