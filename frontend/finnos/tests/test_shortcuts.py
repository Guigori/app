"""Shortcut connection codes: helpers, hourly limit, and only the pending flow left."""
import uuid
from copy import deepcopy

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from finnos.lib import db as store
from finnos.lib import integration_tokens as tokens
from finnos.lib.dates import today_iso
from finnos.routers import shortcuts

TOKEN = "fns_" + "a" * 43


class Rows:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query):
        found = [deepcopy(d) for d in self.docs if store.matches(d, query)]
        return type("Cursor", (), {"to_list": lambda _self, n, **_: _async(found[:n])})()

    async def find_one(self, query, sort=None):
        found = [d for d in self.docs if store.matches(d, query)]
        return deepcopy(found[0]) if found else None

    async def insert_one(self, doc):
        if doc.get("operation_id"):
            doc["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, doc["user_id"] + ":" + doc["operation_id"]))
        if any(d["id"] == doc["id"] for d in self.docs):
            return
        self.docs.append(deepcopy(doc))


async def _async(value):
    return value


@pytest.fixture
def api(monkeypatch):
    data = {
        "accounts": Rows([
            {"id": "acc-nu", "user_id": "alice", "name": "Nubank", "active": True},
            {"id": "acc-it", "user_id": "alice", "name": "Itaú", "active": True},
            {"id": "acc-bob", "user_id": "bob", "name": "Conta do Bob", "active": True},
        ]),
        "cards": Rows([{"id": "card-nu", "user_id": "alice", "name": "Nubank Roxinho", "payment_account_id": "acc-nu", "active": True}]),
        "categories": Rows([
            {"id": "cat-food", "user_id": "alice", "name": "Alimentação"},
            {"id": "cat-car", "user_id": "alice", "name": "Transporte"},
        ]),
        "transactions": Rows([
            {"id": "old-1", "user_id": "alice", "name": "Padaria Pão Quente", "type": "despesa", "category_id": "cat-food", "date": "2026-10-01"},
        ]),
    }
    for name, rows in data.items():
        monkeypatch.setattr(store.db, name, rows)
    log = []
    sessions = {TOKEN: {"uid": "alice", "id": "tok-alice"}}

    def use_token(raw, now=None):
        if raw not in sessions:
            raise HTTPException(401, "Atalho desconectado. Gere um novo código em Configurações → Integrações.")
        return sessions[raw]

    monkeypatch.setattr(tokens, "use_token", use_token)
    monkeypatch.setattr(tokens, "audit", lambda uid, entry: log.append((uid, entry)))
    monkeypatch.setattr(shortcuts, "account_ok", lambda uid: None)
    app = FastAPI()
    app.include_router(shortcuts.router, prefix="/api")
    return TestClient(app), data, log


def test_the_old_direct_flow_is_gone_and_only_pending_remains(api):
    """The ready-made shortcut and "registrar sem abrir" were removed: purchases go through review."""
    client, data, log = api
    auth = {"Authorization": f"Bearer {TOKEN}"}
    assert client.get("/api/shortcuts/opcoes", headers=auth).status_code in (404, 405)
    assert client.post("/api/shortcuts/lancamentos", json={"valor": "10", "tipo": "Despesa"}, headers=auth).status_code in (404, 405)
    assert len(data["transactions"].docs) == 1 and log == []


def test_helpers():
    raw = tokens.new_token()
    assert tokens.looks_like_token(raw) and not tokens.looks_like_token("abc")
    assert tokens.token_hash(raw) != raw and len(tokens.token_hash(raw)) == 64
    assert [str(tokens.parse_amount(v)) for v in ("35,9", "R$35,90", "1.234", "1.234,56", 12.5)] == ["35.90", "35.90", "1234.00", "1234.56", "12.50"]
    for bad in ("0", "-3", "", True):
        with pytest.raises(HTTPException):
            tokens.parse_amount(bad)
    a = tokens.operation_id("u", {"valor": "1"}, now=1000)
    assert a == tokens.operation_id("u", {"valor": "1"}, now=1050) != tokens.operation_id("u", {"valor": "1"}, now=1000 + tokens.DUPLICATE_WINDOW * 2)
    assert tokens.operation_id("u", {"valor": "1"}, now=1000) != tokens.operation_id("v", {"valor": "1"}, now=1000)


def test_hourly_limit():
    start, count = 0, 0
    for _ in range(tokens.RATE_LIMIT):
        start, count = tokens.next_window(start, count, 10)
    with pytest.raises(HTTPException) as exc:
        tokens.next_window(start, count, 20)
    assert exc.value.status_code == 429
    assert tokens.next_window(start, count, 10 + tokens.RATE_WINDOW) == (10 + tokens.RATE_WINDOW, 1)
