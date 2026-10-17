"""HTTP contract for per-UID onboarding (no real Firebase credentials required)."""
from copy import deepcopy
from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from api import index as api
from finnos.routers import onboarding


class Snapshot:
    def __init__(self, document):
        self.document = deepcopy(document)
    def to_dict(self):
        return deepcopy(self.document)


class Ref:
    def __init__(self, store, uid):
        self.store, self.uid = store, uid
    def get(self, timeout=None):
        return Snapshot(self.store.get(self.uid))
    def set(self, payload, merge=False, timeout=None):
        before = self.store.get(self.uid, {}) if merge else {}
        self.store[self.uid] = {**before, **deepcopy(payload)}


@pytest.fixture
def fixture(monkeypatch):
    monkeypatch.setenv("VERCEL_ENV", "preview")
    store = {}
    monkeypatch.setattr(onboarding, "_reference", lambda uid: Ref(store, uid))
    def claims(token, session=False):
        if token not in {"user-a", "user-b"}:
            raise HTTPException(401, "Não autenticado.")
        return {"uid": token, "email": token + "@example.test", "email_verified": True}
    monkeypatch.setattr(api, "verified_claims", claims)
    with TestClient(api.app, base_url="https://preview.example.com") as client:
        yield client, store


def auth(client, uid):
    client.cookies.set(api.COOKIE, uid)


def write(client, url, payload=None):
    return client.request("PATCH" if url == "/api/onboarding" else "POST", url,
                          json=payload, headers={"Origin": "https://preview.example.com"})


def test_requires_valid_session_and_same_origin(fixture):
    client, store = fixture
    assert client.get("/api/onboarding").status_code == 401
    auth(client, "user-a")
    assert client.patch("/api/onboarding", json={"step": 1}).status_code == 403
    assert client.post("/api/onboarding/start", headers={"Origin": "https://attacker.example"}).status_code == 403
    assert not store


def test_legacy_identity_remains_unmodified_until_started(fixture):
    client, store = fixture
    auth(client, "user-a")
    state = client.get("/api/onboarding").json()
    assert state["status"] == "legacy" and state["step"] == 0
    assert store == {}
    state = write(client, "/api/onboarding/start").json()
    assert state["status"] == "in_progress" and state["step"] == 0


def test_progress_skip_resume_completion_survives_new_session(fixture):
    client, store = fixture
    auth(client, "user-a")
    write(client, "/api/onboarding/start")
    saved = write(client, "/api/onboarding", {
        "status": "in_progress", "step": 2, "income_cents": 310000,
        "budget_mode": "personalizado",
        "budget_percentages": {"necessidades": 40, "desejos": 25, "metas": 35}
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["budget_percentages"]["metas"] == 35
    write(client, "/api/onboarding", {"status": "skipped", "step": 2})
    client.cookies.clear()
    auth(client, "user-a")
    assert client.get("/api/onboarding").json()["status"] == "skipped"
    assert write(client, "/api/onboarding/start").json()["step"] == 2
    state = write(client, "/api/onboarding", {"status": "completed", "step": 5,
               "first_entry_seen": True, "tour_seen": True}).json()
    assert state["status"] == "completed"
    assert write(client, "/api/onboarding/start").json()["status"] == "completed"


def test_uid_isolation_and_identity_mismatch(fixture):
    client, store = fixture
    auth(client, "user-a")
    write(client, "/api/onboarding/start")
    write(client, "/api/onboarding", {"income_cents": 310000})
    auth(client, "user-b")
    assert client.get("/api/onboarding").json()["income_cents"] is None
    assert client.get("/api/onboarding", headers={"X-FINNOS-User-ID": "user-a"}).status_code == 401
    write(client, "/api/onboarding", {"income_cents": 80000})
    assert store["user-a"]["income_cents"] == 310000
    assert store["user-b"]["income_cents"] == 80000


def test_budget_validation_rejects_invalid_configuration(fixture):
    client, store = fixture
    auth(client, "user-a")
    bad = [
        {"step": 6}, {"income_cents": -1},
        {"budget_percentages": {"necessidades": 50, "desejos": 25, "metas": 20}},
        {"budget_percentages": {"necessidades": 101, "desejos": 0, "metas": -1}},
    ]
    for payload in bad:
        response = write(client, "/api/onboarding", payload)
        assert response.status_code == 422, response.text
    assert store == {}
    state = write(client, "/api/onboarding", {"budget_mode": "503020"}).json()
    assert state["budget_percentages"] == {"necessidades": 50, "desejos": 30, "metas": 20}
