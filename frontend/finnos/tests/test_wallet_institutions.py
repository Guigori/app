"""Carteira foundation: every account and card has an institution, the
institution decides the color, and there is exactly one default per kind."""
import asyncio
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from finnos.lib import db as store
from finnos.lib import institution_links
from finnos.lib.institution_catalog import CATALOG, fallback_color, institution_identity
from finnos.lib.wallet_defaults import default_scope, effective_defaults, other_defaults
from finnos.models.cards import CardIn
from finnos.models.finnos import AccountIn
from finnos.routers import accounts, cards, institutions
from finnos.routers.auth import require_user

SRC = Path(__file__).resolve().parents[2] / "src"


# --- Catalog -----------------------------------------------------------------

def test_catalog_entry_sets_name_color_and_kind():
    assert institution_identity("", "nubank") == {"name": "Nubank", "color": "#820AD1", "kind": "banco", "catalog_id": "nubank"}
    assert institution_identity("qualquer", "alelo")["kind"] == "beneficio"


def test_only_the_exact_name_takes_the_catalog_color_never_an_alias():
    assert institution_identity("  nubank ")["catalog_id"] == "nubank"
    assert institution_identity("ITAÚ")["color"] == "#EC7000"
    for alias in ("Nu Bank", "Nu", "Banco Inter", "Itaú Unibanco"):
        identity = institution_identity(alias)
        assert identity["catalog_id"] is None and identity["kind"] == "outro"


def test_custom_institutions_get_a_stable_color_from_the_name():
    assert fallback_color("Cooperativa Local") == fallback_color("  cooperativa   local ")
    assert institution_identity("Cooperativa Local")["color"] == fallback_color("Cooperativa Local")


def test_frontend_catalog_matches_the_server_catalog():
    text = (SRC / "lib" / "institutionCatalog.ts").read_text(encoding="utf-8")
    entries = re.findall(r'\{ id: "([^"]+)", name: "([^"]+)", color: "(#[0-9A-Fa-f]{6})", kind: "([a-z]+)" \}', text)
    assert entries == [(i["id"], i["name"], i["color"], i["kind"]) for i in CATALOG]


# --- Defaults ------------------------------------------------------------------

def test_one_default_per_kind_of_payment():
    assert default_scope("cards", {}) == "card"
    assert default_scope("accounts", {"type": "digital"}) == "account"
    assert default_scope("accounts", {"type": "beneficio"}) == "benefit"
    assert default_scope("accounts", {"type": "carteira"}) == "cash"
    rows = [
        {"id": "a", "type": "corrente", "is_default": True},
        {"id": "b", "type": "beneficio", "is_default": True},
        {"id": "c", "type": "digital"},
    ]
    # Making "c" the default only unsets the other bank account, not the benefit.
    assert [r["id"] for r in other_defaults("accounts", {"id": "c", "type": "digital", "is_default": True}, rows)] == ["a"]
    assert other_defaults("accounts", {"id": "c", "type": "digital", "is_default": False}, rows) == []


def test_effective_default_falls_back_to_the_oldest_active_item():
    docs = [
        {"id": "old", "type": "corrente", "created_at": "2026-01-01", "active": False},
        {"id": "mid", "type": "corrente", "created_at": "2026-02-01"},
        {"id": "new", "type": "corrente", "created_at": "2026-03-01"},
        {"id": "vr", "type": "beneficio", "created_at": "2026-04-01"},
    ]
    assert effective_defaults("accounts", docs) == {"mid", "vr"}
    docs[2]["is_default"] = True
    assert effective_defaults("accounts", docs) == {"new", "vr"}


def test_saving_without_the_flag_keeps_the_current_default():
    account = AccountIn(name="Conta", institution="Nubank", type="corrente", initial_balance=0, active=True)
    assert "is_default" not in accounts._payload(account)
    assert accounts._payload(account.model_copy(update={"is_default": True}))["is_default"] is True
    card = CardIn(name="Roxinho", institution="Nubank", limit=1000, closing_day=3, due_day=10)
    assert "is_default" not in cards._payload(card)


# --- Adapter: color from the institution, single default -------------------------

class Snap:
    def __init__(self, data):
        self.data = data
        self.exists = data is not None

    def to_dict(self):
        return deepcopy(self.data)


class FakeTransaction:
    def __init__(self):
        self.sets, self.creates = [], []

    def set(self, ref, data):
        self.sets.append((ref.path, data))

    def create(self, ref, data):
        self.creates.append((ref.path, data))


class Ref:
    def __init__(self, data, path):
        self.data, self.path = data, path

    def collection(self, name):
        return Ref(self.data, self.path + [name])

    def document(self, identifier):
        return Ref(self.data, self.path + [identifier])

    def get(self, transaction=None):
        node = self.data
        for part in self.path:
            node = node.get(part) if isinstance(node, dict) else None
            if node is None:
                return Snap(None)
        return Snap(node)


def run_validate(monkeypatch, name, doc, data, existing_rows):
    monkeypatch.setattr(store, "root", lambda db, uid: Ref(data, []))
    monkeypatch.setattr(store, "rows", lambda db, uid, collection, transaction=None: deepcopy(existing_rows))
    transaction = FakeTransaction()
    store.validate_refs(None, "owner", name, doc, transaction)
    return transaction


def test_linked_account_takes_the_institution_name_and_color(monkeypatch):
    data = {"institutions": {"inst": {"name": "Nubank", "color": "#820AD1"}}}
    doc = {"id": "acc", "name": "Conta", "institution": "nubank", "institution_id": "inst", "color": "#123456", "type": "digital"}
    run_validate(monkeypatch, "accounts", doc, data, [])
    assert doc["institution"] == "Nubank" and doc["color"] == "#820AD1"


def test_new_default_unsets_the_previous_one_in_the_same_transaction(monkeypatch):
    rows = [
        {"id": "a", "user_id": "owner", "type": "corrente", "is_default": True, "version": 3},
        {"id": "vr", "user_id": "owner", "type": "beneficio", "is_default": True, "version": 1},
    ]
    doc = {"id": "b", "type": "digital", "is_default": True}
    transaction = run_validate(monkeypatch, "accounts", doc, {}, rows)
    assert [(path[-1], body["is_default"], body["version"]) for path, body in transaction.sets] == [("a", False, 4)]
    # The change is recorded in the finance history like any other edit.
    assert any(path[-2] == "finance_history" for path, _ in transaction.creates)


def test_cards_have_a_single_default_too(monkeypatch):
    rows = [{"id": "one", "user_id": "owner", "is_default": True}, {"id": "two", "user_id": "owner"}]
    transaction = run_validate(monkeypatch, "cards", {"id": "two", "is_default": True}, {}, rows)
    assert [path[-1] for path, _ in transaction.sets] == ["one"]


# --- Routes ----------------------------------------------------------------------

class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *args):
        return self

    async def to_list(self, size):
        return deepcopy(self.rows)


class MemoryCollection:
    def __init__(self, rows=None):
        self.rows = rows or []

    def find(self, query):
        return Cursor([r for r in self.rows if r["user_id"] == query["user_id"]])

    async def insert_one(self, doc):
        self.rows.append(deepcopy(doc))

    async def update_one(self, query, update):
        for row in self.rows:
            if row["id"] == query["id"] and row["user_id"] == query["user_id"]:
                row.update(update["$set"])
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def delete_one(self, query):
        before = len(self.rows)
        self.rows = [r for r in self.rows if not (r["id"] == query["id"] and r["user_id"] == query["user_id"])]
        return SimpleNamespace(deleted_count=before - len(self.rows))


@pytest.fixture
def memory(monkeypatch):
    fake = SimpleNamespace(institutions=MemoryCollection(), accounts=MemoryCollection(), cards=MemoryCollection())
    monkeypatch.setattr(institutions, "db", fake)
    monkeypatch.setattr(institution_links, "db", fake)
    app = FastAPI()
    app.include_router(institutions.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": "alice"}
    return fake, TestClient(app)


def test_catalog_route_and_creation_from_the_catalog(memory):
    fake, client = memory
    catalog = client.get("/api/institutions/catalog").json()
    assert {"id": "inter", "name": "Inter", "color": "#FF7A00", "kind": "banco"} in catalog
    created = client.post("/api/institutions", json={"catalog_id": "inter", "color": "#000000"})
    assert created.status_code == 201
    assert created.json()["name"] == "Inter" and created.json()["color"] == "#FF7A00"
    # The same name again returns the one already registered, not a duplicate.
    again = client.post("/api/institutions", json={"name": "inter"})
    assert again.status_code == 200 and again.json()["id"] == created.json()["id"]
    assert len(fake.institutions.rows) == 1


def test_a_name_is_required_without_a_catalog_entry(memory):
    _, client = memory
    assert client.post("/api/institutions", json={"name": " a "}).status_code == 422


def test_link_legacy_connects_text_only_banks_once(memory):
    fake, client = memory
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    fake.accounts.rows += [
        {"id": "a1", "user_id": "alice", "name": "Conta", "institution": "Nubank", "type": "digital", "created_at": now},
        {"id": "a2", "user_id": "alice", "name": "Salário", "institution": " nubank", "type": "corrente", "created_at": now},
        {"id": "cash", "user_id": "alice", "name": "Carteira", "institution": "Dinheiro", "type": "carteira", "created_at": now},
        {"id": "other", "user_id": "bob", "name": "Conta", "institution": "Itaú", "type": "corrente", "created_at": now},
    ]
    fake.cards.rows += [{"id": "c1", "user_id": "alice", "name": "Roxinho", "institution": "Cooperativa Local", "created_at": now}]
    result = client.post("/api/institutions/link-legacy").json()
    assert result == {"linked_accounts": 2, "linked_cards": 1, "created_institutions": 2}
    by_id = {r["id"]: r for r in fake.accounts.rows}
    assert by_id["a1"]["institution_id"] == by_id["a2"]["institution_id"]
    assert "institution_id" not in by_id["cash"] and "institution_id" not in by_id["other"]
    names = sorted(i["name"] for i in fake.institutions.rows)
    assert names == ["Cooperativa Local", "Nubank"]
    # Running it again changes nothing.
    assert client.post("/api/institutions/link-legacy").json() == {"linked_accounts": 0, "linked_cards": 0, "created_institutions": 0}


def test_saving_with_a_typed_bank_name_links_the_institution(memory):
    fake, _ = memory
    payload = {"name": "Conta", "institution": "Itaú", "institution_id": None, "type": "corrente"}
    resolved = asyncio.run(institution_links.resolve_institution("alice", "accounts", payload))
    assert resolved["institution"] == "Itaú" and resolved["institution_id"] == fake.institutions.rows[0]["id"]
    cash = asyncio.run(institution_links.resolve_institution("alice", "accounts", {"institution": "Dinheiro", "type": "carteira"}))
    assert "institution_id" not in cash
    assert len(fake.institutions.rows) == 1


def test_default_routes_set_the_flag(monkeypatch):
    calls = []

    class Recorder:
        async def update_one(self, query, update):
            calls.append((query, update["$set"]["is_default"]))
            return SimpleNamespace(matched_count=0)

    monkeypatch.setattr(accounts, "db", SimpleNamespace(accounts=Recorder()))
    monkeypatch.setattr(cards, "db", SimpleNamespace(cards=Recorder()))
    app = FastAPI()
    app.include_router(accounts.router, prefix="/api")
    app.include_router(cards.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": "alice"}
    client = TestClient(app)
    assert client.post("/api/accounts/x/default").status_code == 404
    assert client.post("/api/cards/y/default").status_code == 404
    assert calls == [({"id": "x", "user_id": "alice"}, True), ({"id": "y", "user_id": "alice"}, True)]


def test_fallback_color_arithmetic_is_the_same_as_the_frontend():
    text = (SRC / "lib" / "institutionCatalog.ts").read_text(encoding="utf-8")
    assert "sum += ch.codePointAt(0)" in text and "sum % FALLBACK_COLORS.length" in text
    colors = re.search(r"const FALLBACK_COLORS = \[(.*?)\];", text).group(1)
    from finnos.lib.institution_catalog import FALLBACK_COLORS
    assert re.findall(r'"(#[0-9A-Fa-f]{6})"', colors) == FALLBACK_COLORS
