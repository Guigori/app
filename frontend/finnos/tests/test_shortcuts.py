"""Apple Shortcuts register: code required, app rules kept, saved once, every use logged."""
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


def post(client, body, token=TOKEN):
    return client.post("/api/shortcuts/lancamentos", json=body, headers={"Authorization": f"Bearer {token}"} if token else {})


def test_needs_a_valid_code_and_always_answers_with_a_message(api):
    client, data, log = api
    missing = post(client, {"valor": "10"}, token=None)
    assert missing.status_code == 401 and missing.json()["ok"] is False and "código" in missing.json()["mensagem"]
    revoked = post(client, {"valor": "10"}, token="fns_" + "b" * 43)
    assert revoked.status_code == 401 and "desconectado" in revoked.json()["mensagem"]
    assert len(data["transactions"].docs) == 1 and log == []


def test_registers_through_the_app_rules_and_logs_it(api):
    client, data, log = api
    r = post(client, {"valor": "35,90", "tipo": "Despesa", "forma": "Pix", "carteira": "nubank", "categoria": "alimentacao", "descricao": "Almoço"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["ok"] and body["mensagem"] == "Registrado no FINNOS: Almoço · R$ 35,90 · Nubank · Alimentação"
    doc = data["transactions"].docs[-1]
    assert (doc["user_id"], doc["account_id"], doc["category_id"], doc["card_id"]) == ("alice", "acc-nu", "cat-food", None)
    assert (doc["type"], doc["status"], doc["date"], doc["source"]) == ("despesa", "pago", today_iso(), "ios_shortcut")
    assert str(doc["value"]) == "35.90" and doc["notes"] == "Registrado pelo Atalhos · Pix"
    assert log[-1][0] == "alice" and log[-1][1]["ok"] and log[-1][1]["transaction_id"] == doc["id"]


def test_the_same_send_twice_is_saved_once(api):
    client, data, _ = api
    body = {"valor": "12", "tipo": "despesa", "carteira": "Itaú", "descricao": "Café"}
    first, second = post(client, body), post(client, body)
    assert first.status_code == 201 and second.status_code == 200
    assert second.json()["repetido"] is True and second.json()["mensagem"].startswith("Já estava registrado")
    assert len([d for d in data["transactions"].docs if d["name"] == "Café"]) == 1


def test_credit_card_installments_use_the_card_payment_account(api):
    client, data, _ = api
    r = post(client, {"valor": "300", "forma": "Crédito", "carteira": "Nubank Roxinho", "parcelas": "3x", "descricao": "Tênis"})
    assert r.status_code == 201, r.text
    doc = data["transactions"].docs[-1]
    assert (doc["card_id"], doc["account_id"], doc["installment"], doc["total_installments"]) == ("card-nu", "acc-nu", True, 3)
    assert "em 3x" in r.json()["mensagem"]


def test_apple_pay_values_match_wallet_names_and_learn_the_category(api):
    client, data, _ = api
    # Wallet sends its own card name and the amount with currency.
    r = post(client, {"valor": "R$ 1.234,56", "carteira": "Nubank Roxinho Ultravioleta", "descricao": "Padaria Pão Quente"})
    assert r.status_code == 201, r.text
    doc = data["transactions"].docs[-1]
    assert doc["card_id"] == "card-nu" and doc["category_id"] == "cat-food" and str(doc["value"]) == "1234.56"


@pytest.mark.parametrize("body, words", [
    ({"valor": "50", "carteira": "Itaú", "parcelas": 2}, "só no cartão"),
    ({"valor": "50", "tipo": "receita", "forma": "credito"}, "Receita não pode"),
    ({"valor": "50", "carteira": "Conta do Bob"}, "Não encontrei a conta"),
    ({"valor": "50"}, "Escolha a conta"),
    ({"valor": "abc", "carteira": "Itaú"}, "Valor inválido"),
    ({"valor": "50", "carteira": "Itaú", "forma": "boleto"}, "Forma de pagamento inválida"),
])
def test_refusals_explain_what_to_fix_and_save_nothing(api, body, words):
    client, data, log = api
    r = post(client, body)
    assert r.status_code == 422 and r.json()["ok"] is False and words in r.json()["mensagem"]
    assert len(data["transactions"].docs) == 1
    assert log[-1][1]["ok"] is False


def test_options_list_only_the_users_own_names(api):
    client, _, _ = api
    body = client.get("/api/shortcuts/opcoes", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert body["contas"] == ["Nubank", "Itaú"] and body["cartoes"] == ["Nubank Roxinho"]
    assert body["carteiras"] == ["Nubank", "Itaú", "Nubank Roxinho"]
    assert body["categorias"] == ["Alimentação", "Transporte"] and "Pix" in body["formas"]


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
