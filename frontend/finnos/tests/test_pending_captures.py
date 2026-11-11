"""Compras pendentes do Apple Pay: guardadas no servidor, origem conferida, registrar/excluir."""
import asyncio
import uuid
from copy import deepcopy

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from finnos.lib import db as store
from finnos.lib import integration_tokens as tokens
from finnos.lib import pending_captures as pending
from finnos.lib.dates import today_iso
from finnos.routers import notifications, pending_captures, shortcuts
from finnos.routers.auth import require_user

TOKEN = "fns_" + "a" * 43
ACCOUNTS = [
    {"id": "acc-nu", "user_id": "alice", "name": "Nubank", "active": True},
    {"id": "acc-it", "user_id": "alice", "name": "Itaú", "active": True},
]
CARDS = [{"id": "card-nu", "user_id": "alice", "name": "Nubank Roxinho", "payment_account_id": "acc-nu", "active": True}]


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

    async def delete_one(self, query):
        before = len(self.docs)
        self.docs[:] = [d for d in self.docs if not store.matches(d, query)]
        return type("Result", (), {"deleted_count": before - len(self.docs)})()


async def _async(value):
    return value


@pytest.fixture
def api(monkeypatch):
    data = {
        "accounts": Rows(deepcopy(ACCOUNTS)),
        "cards": Rows(deepcopy(CARDS)),
        "categories": Rows([{"id": "cat-food", "user_id": "alice", "name": "Alimentação"}, {"id": "cat-mkt", "user_id": "alice", "name": "Mercado"}]),
        "transactions": Rows([{"id": "old-1", "user_id": "alice", "name": "Mercado Ernesto", "type": "despesa", "category_id": "cat-mkt", "date": "2026-10-01"}]),
        "notification_preferences": Rows([]),
    }
    for name, rows in data.items():
        monkeypatch.setattr(store.db, name, rows)

    waiting: dict[tuple[str, str], dict] = {}
    monkeypatch.setattr(pending, "save", lambda uid, doc: _save(waiting, uid, doc))
    monkeypatch.setattr(pending, "count", lambda uid: sum(1 for (u, _) in waiting if u == uid))
    monkeypatch.setattr(pending, "list_all", lambda uid: [deepcopy(d) for (u, _), d in waiting.items() if u == uid])
    monkeypatch.setattr(pending, "get", lambda uid, cid: deepcopy(waiting.get((uid, cid))))
    monkeypatch.setattr(pending, "remove", lambda uid, cid: waiting.pop((uid, cid), None) is not None)

    memory = {"settings": {"auto_register": False}, "alerts": [], "rules": {}, "auto": {}}
    monkeypatch.setattr(pending, "learned", lambda uid: _rules_of(memory, uid))
    monkeypatch.setattr(pending, "save_rules", lambda uid, changed: [memory["rules"].__setitem__((uid, r["id"]), deepcopy(r)) for r in changed] and None)
    monkeypatch.setattr(pending, "auto_log_save", lambda uid, entry: memory["auto"].__setitem__((uid, entry["id"]), deepcopy(entry)))
    monkeypatch.setattr(pending, "auto_log_list", lambda uid: [deepcopy(e) for (u, _), e in memory["auto"].items() if u == uid])
    monkeypatch.setattr(pending, "auto_log_get", lambda uid, eid: deepcopy(memory["auto"].get((uid, eid))))
    monkeypatch.setattr(pending, "auto_log_remove", lambda uid, eid: memory["auto"].pop((uid, eid), None) is not None)
    monkeypatch.setattr(pending, "get_settings", lambda uid: dict(memory["settings"]))
    monkeypatch.setattr(pending, "save_settings", lambda uid, patch: memory["settings"].update(patch) or dict(memory["settings"]))
    monkeypatch.setattr(pending, "alert", lambda uid, title, body, url="/": memory["alerts"].append((uid, title, body)) or 1)

    log = []
    monkeypatch.setattr(tokens, "use_token", lambda raw, now=None: {"uid": "alice", "id": "tok"} if raw == TOKEN else (_ for _ in ()).throw(HTTPException(401, "Atalho desconectado.")))
    monkeypatch.setattr(tokens, "audit", lambda uid, entry: log.append((uid, entry)))
    monkeypatch.setattr(shortcuts, "account_ok", lambda uid: None)

    app = FastAPI()
    app.include_router(shortcuts.router, prefix="/api")
    app.include_router(pending_captures.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": "alice", "email": "a@x.com"}
    return TestClient(app), data, waiting, log, memory


def _rules_of(memory, uid):
    rules = pending.empty_rules()
    for (u, _), rule in memory["rules"].items():
        if u == uid:
            rules["merchants" if rule["kind"] == "comerciante" else "cards"][rule["key"]] = deepcopy(rule)
    return rules


def _save(waiting, uid, doc):
    key = (uid, doc["id"])
    if key in waiting:
        return waiting[key], False
    waiting[key] = doc
    return doc, True


def capture(client, body, token=TOKEN):
    return client.post("/api/shortcuts/pendentes", json=body, headers={"Authorization": f"Bearer {token}"} if token else {})


# --- which wallet is it? ------------------------------------------------------

def test_card_and_account_are_found_by_the_name_the_phone_sends():
    assert pending.identify_source("Nubank Roxinho", ACCOUNTS, CARDS)["kind"] == "cartao"
    # Partial name: "Nubank" fits the card and the account; the card wins (Apple Pay names cards).
    found = pending.identify_source("nubank", ACCOUNTS, CARDS)
    assert (found["kind"], found["name"], found["pays_from"]) == ("cartao", "Nubank Roxinho", "Nubank")
    assert pending.identify_source("ITAU", ACCOUNTS, CARDS)["kind"] == "conta"


def test_unknown_or_ambiguous_wallet_is_reported_not_guessed():
    for sent in ("Refeição Pass", "", None):
        found = pending.identify_source(sent, ACCOUNTS, CARDS)
        assert found["kind"] == "desconhecido" and found["registered"] is False and found["id"] is None
    twins = CARDS + [{"id": "card-nu2", "user_id": "alice", "name": "Nubank Ultravioleta", "payment_account_id": "acc-nu", "active": True}]
    assert pending.identify_source("Nubank", [], twins)["registered"] is False


def test_origin_label_is_plain_portuguese():
    assert pending.origin_label(pending.identify_source("Nubank Roxinho", ACCOUNTS, CARDS)) == "Cartão Nubank Roxinho · fatura paga por Nubank"
    assert pending.origin_label(pending.identify_source("Itaú", ACCOUNTS, CARDS)) == "Conta Itaú"
    assert "Refeição Pass" in pending.origin_label(pending.identify_source("Refeição Pass", ACCOUNTS, CARDS))
    assert pending.origin_label(pending.identify_source(None, ACCOUNTS, CARDS)) == "Sem cartão informado pelo Apple Pay"


# --- the Shortcut leaves the purchase pending ---------------------------------

def test_the_shortcut_needs_its_code_and_a_valid_amount(api):
    client, _, waiting, *_ = api
    assert capture(client, {"valor": "4,99"}, token=None).status_code == 401
    bad = capture(client, {"valor": "abc"})
    assert bad.status_code == 422 and bad.json()["ok"] is False
    assert waiting == {}


def test_a_purchase_is_saved_as_pending_without_touching_the_balance(api):
    client, data, waiting, log, _ = api
    r = capture(client, {"valor": "R$ 4,99", "descricao": "Mercado Do Ernesto", "carteira": "Nubank Roxinho"})
    assert r.status_code == 201
    body = r.json()
    assert body["ok"] and body["cadastrado"] is True and body["origem"] == "Cartão Nubank Roxinho · fatura paga por Nubank"
    assert len(waiting) == 1 and len(data["transactions"].docs) == 1  # only the old one: nothing registered
    assert log[-1][1]["ok"] and log[-1][1]["action"] == "pendente"


def test_an_unregistered_card_is_kept_and_flagged(api):
    client, _, waiting, *_ = api
    r = capture(client, {"valor": "4,99", "descricao": "Mercado Do Ernesto", "carteira": "Refeição Pass"})
    assert r.status_code == 201
    assert r.json()["cadastrado"] is False and "não está cadastrado" in r.json()["origem"]
    assert len(waiting) == 1


def test_the_same_purchase_sent_twice_is_one_pending(api):
    client, _, waiting, *_ = api
    first = capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Nubank Roxinho", "id": "wallet-123"})
    again = capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Nubank Roxinho", "id": "wallet-123"})
    assert (first.status_code, again.status_code) == (201, 200) and again.json()["repetido"] is True
    assert len(waiting) == 1


def test_two_different_purchases_in_a_row_are_both_kept(api):
    """The bug that started this: the second purchase, with the app open, was lost."""
    client, _, waiting, *_ = api
    assert capture(client, {"valor": "4,99", "descricao": "Mercado Do Ernesto", "carteira": "Refeição Pass"}).status_code == 201
    assert capture(client, {"valor": "18,50", "descricao": "Padaria", "carteira": "Nubank Roxinho"}).status_code == 201
    assert len(waiting) == 2


def test_too_many_waiting_purchases_are_refused_with_a_message(api, monkeypatch):
    client, _, waiting, *_ = api
    monkeypatch.setattr(pending, "MAX_PENDING", 1)
    assert capture(client, {"valor": "1,00", "descricao": "A"}).status_code == 201
    full = capture(client, {"valor": "2,00", "descricao": "B"})
    assert full.status_code == 429 and full.json()["ok"] is False and len(waiting) == 1


# --- seeing them in the app ---------------------------------------------------

def test_the_list_shows_where_the_money_comes_from(api):
    client, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado Do Ernesto", "carteira": "Refeição Pass"})
    capture(client, {"valor": "18,50", "descricao": "Padaria", "carteira": "Nubank Roxinho"})
    listed = client.get("/api/pending-captures").json()
    assert listed["count"] == 2
    by_name = {i["name"]: i for i in listed["items"]}
    assert by_name["Padaria"]["source_registered"] and by_name["Padaria"]["source_kind"] == "cartao" and by_name["Padaria"]["value"] == 18.5
    assert by_name["Mercado Do Ernesto"]["source_registered"] is False and by_name["Mercado Do Ernesto"]["source_sent"] == "Refeição Pass"


def test_registering_the_missing_card_later_clears_the_warning(api):
    client, data, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Refeição Pass"})
    assert client.get("/api/pending-captures").json()["items"][0]["source_registered"] is False
    data["accounts"].docs.append({"id": "acc-vr", "user_id": "alice", "name": "Refeição Pass", "active": True})
    item = client.get("/api/pending-captures").json()["items"][0]
    assert item["source_registered"] is True and item["source_kind"] == "conta"


def test_nobody_sees_someone_elses_pending_purchases(api):
    client, _, waiting, *_ = api
    waiting[("bob", "x")] = {"id": "x", "name": "Do Bob", "value_cents": 100, "date": today_iso(), "source": {"sent": None}}
    assert client.get("/api/pending-captures").json()["count"] == 0
    assert client.delete("/api/pending-captures/x").status_code == 404
    assert ("bob", "x") in waiting


# --- registering or deleting --------------------------------------------------

def _first_id(client):
    return client.get("/api/pending-captures").json()["items"][0]["id"]


def test_confirming_creates_the_lancamento_on_the_card_and_clears_the_pending(api):
    client, data, waiting, *_ = api
    capture(client, {"valor": "18,50", "descricao": "Mercado Ernesto", "carteira": "Nubank Roxinho"})
    r = client.post(f"/api/pending-captures/{_first_id(client)}/confirm", json={})
    assert r.status_code == 201 and r.json()["ok"]
    made = [t for t in data["transactions"].docs if t["id"] != "old-1"]
    assert len(made) == 1 and waiting == {}
    tx = made[0]
    assert (tx["card_id"], tx["account_id"], tx["type"], tx["source"]) == ("card-nu", "acc-nu", "despesa", "ios_shortcut")
    assert float(tx["value"]) == 18.5 and tx["category_id"] == "cat-mkt"  # category learned from the same merchant


def test_confirming_without_a_known_wallet_asks_instead_of_guessing(api):
    client, data, waiting, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado Do Ernesto", "carteira": "Refeição Pass"})
    cid = _first_id(client)
    refused = client.post(f"/api/pending-captures/{cid}/confirm", json={})
    assert refused.status_code == 422 and "de onde saiu" in refused.json()["detail"]
    assert len(waiting) == 1 and len(data["transactions"].docs) == 1  # kept, nothing registered
    ok = client.post(f"/api/pending-captures/{cid}/confirm", json={"account_id": "acc-it", "category_id": "cat-food", "name": "Mercado Ernesto"})
    assert ok.status_code == 201 and waiting == {}
    tx = [t for t in data["transactions"].docs if t["id"] != "old-1"][0]
    assert (tx["account_id"], tx["card_id"], tx["category_id"], tx["name"]) == ("acc-it", None, "cat-food", "Mercado Ernesto")


def test_the_person_can_correct_value_date_and_wallet_before_registering(api):
    client, data, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Itaú"})
    r = client.post(f"/api/pending-captures/{_first_id(client)}/confirm", json={"value": "5,49", "date": "2026-11-01", "card_id": "card-nu"})
    assert r.status_code == 201
    tx = [t for t in data["transactions"].docs if t["id"] != "old-1"][0]
    assert float(tx["value"]) == 5.49 and tx["date"] == "2026-11-01" and tx["card_id"] == "card-nu"


def test_invalid_choices_are_refused_and_keep_the_pending(api):
    client, _, waiting, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Itaú"})
    cid = _first_id(client)
    assert client.post(f"/api/pending-captures/{cid}/confirm", json={"account_id": "acc-bob"}).status_code == 422
    assert client.post(f"/api/pending-captures/{cid}/confirm", json={"card_id": "nope"}).status_code == 422
    assert client.post(f"/api/pending-captures/{cid}/confirm", json={"installments": 3}).status_code == 422  # no card
    assert client.post(f"/api/pending-captures/{cid}/confirm", json={"value": "zero"}).status_code == 422
    assert len(waiting) == 1


def test_confirming_twice_registers_once(api):
    client, data, waiting, *_ = api
    capture(client, {"valor": "18,50", "descricao": "Padaria", "carteira": "Nubank Roxinho"})
    cid = _first_id(client)
    saved = dict(waiting[("alice", cid)])
    assert client.post(f"/api/pending-captures/{cid}/confirm", json={}).status_code == 201
    # A retry after a slow network: the pending is gone (404), and nothing is duplicated.
    assert client.post(f"/api/pending-captures/{cid}/confirm", json={}).status_code == 404
    assert len([t for t in data["transactions"].docs if t["id"] != "old-1"]) == 1
    # Even if the delete had failed and the pending came back, the same id is not created twice.
    waiting[("alice", cid)] = saved
    assert client.post(f"/api/pending-captures/{cid}/confirm", json={}).status_code == 201
    assert len([t for t in data["transactions"].docs if t["id"] != "old-1"]) == 1


def test_deleting_discards_without_registering(api):
    client, data, waiting, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Itaú"})
    cid = _first_id(client)
    assert client.delete(f"/api/pending-captures/{cid}").status_code == 204
    assert waiting == {} and len(data["transactions"].docs) == 1
    assert client.delete(f"/api/pending-captures/{cid}").status_code == 404


# --- the bell -----------------------------------------------------------------

def test_pending_purchases_show_in_avisos_first(api):
    client, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado Do Ernesto", "carteira": "Refeição Pass"})
    items = asyncio.run(notifications._pending_items("alice", set()))
    assert len(items) == 1
    item = items[0]
    assert item.kind == "captura" and item.title == "Compra pendente: Mercado Do Ernesto"
    assert "não está cadastrado" in item.description and item.days_left < 0
    assert "há" not in item.description  # fresh: no "waiting for days" note
    assert asyncio.run(notifications._pending_items("alice", {item.id})) == []  # dismissed from the bell


# --- registering the missing card, or pointing the purchase elsewhere ---------

def test_registering_the_card_with_the_name_apple_pay_uses_makes_the_purchase_known(api):
    client, data, waiting, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Refeição Pass"})
    assert client.get("/api/pending-captures").json()["items"][0]["source_registered"] is False
    # What the app does when the person registers the card: a card/account named like Apple Pay names it.
    data["accounts"].docs.append({"id": "acc-vr", "user_id": "alice", "name": "Refeição Pass", "active": True})
    item = client.get("/api/pending-captures").json()["items"][0]
    assert (item["source_registered"], item["source_kind"], item["origin"]) == (True, "conta", "Conta Refeição Pass")
    # The next purchase from that card is known right away, with nothing to choose.
    capture(client, {"valor": "6,00", "descricao": "Padaria", "carteira": "refeicao pass"})
    assert all(i["source_registered"] for i in client.get("/api/pending-captures").json()["items"])
    assert client.post(f"/api/pending-captures/{item['id']}/confirm", json={}).status_code == 201


def test_pointing_one_purchase_at_another_wallet_does_not_change_the_next_one(api):
    client, data, waiting, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Refeição Pass"})
    cid = _first_id(client)
    assert client.post(f"/api/pending-captures/{cid}/confirm", json={"account_id": "acc-it"}).status_code == 201
    capture(client, {"valor": "6,00", "descricao": "Padaria", "carteira": "Refeição Pass"})
    assert client.get("/api/pending-captures").json()["items"][0]["source_registered"] is False


# --- register all -------------------------------------------------------------

def test_register_all_registers_the_known_ones_and_leaves_the_rest(api):
    client, data, waiting, *_ = api
    capture(client, {"valor": "18,50", "descricao": "Padaria", "carteira": "Nubank Roxinho"})
    capture(client, {"valor": "9,90", "descricao": "Café", "carteira": "Itaú"})
    capture(client, {"valor": "4,99", "descricao": "Mercado Do Ernesto", "carteira": "Refeição Pass"})
    r = client.post("/api/pending-captures/confirm-all").json()
    # Café (Itaú) goes; Refeição Pass has no account; "Nubank Roxinho" is both a card and an account name.
    assert (r["registered"], r["skipped"], r["failed"], r["ok"]) == (1, 2, [], True)
    assert len(data["transactions"].docs) == 2
    assert sorted(v["name"] for v in waiting.values()) == ["Mercado Do Ernesto", "Padaria"]  # never guessed


def test_register_all_is_debit_and_skips_what_has_no_account_to_come_from(api):
    client, data, waiting, *_ = api
    data["cards"].docs[0]["payment_account_id"] = None  # a card with no paying account: no débito to suggest
    capture(client, {"valor": "18,50", "descricao": "Padaria", "carteira": "Nubank Roxinho"})
    capture(client, {"valor": "9,90", "descricao": "Café", "carteira": "Itaú"})
    r = client.post("/api/pending-captures/confirm-all").json()
    assert (r["registered"], r["skipped"]) == (1, 1) and len(waiting) == 1
    made = [t for t in data["transactions"].docs if t["id"] != "old-1"]
    assert made[0]["account_id"] == "acc-it" and made[0].get("card_id") is None


# --- the test purchase --------------------------------------------------------

def test_a_test_purchase_shows_the_flow_but_cannot_be_registered(api):
    client, data, waiting, *_ = api
    made = client.post("/api/pending-captures/test")
    assert made.status_code == 201
    item = client.get("/api/pending-captures").json()["items"][0]
    assert item["is_test"] and item["name"] == "Compra de teste"
    refused = client.post(f"/api/pending-captures/{item['id']}/confirm", json={"account_id": "acc-it"})
    assert refused.status_code == 422 and "teste" in refused.json()["detail"]
    assert client.post("/api/pending-captures/confirm-all").json()["registered"] == 0
    assert len(data["transactions"].docs) == 1
    assert client.delete(f"/api/pending-captures/{item['id']}").status_code == 204 and waiting == {}


# --- register on its own ------------------------------------------------------

def _auto(client, memory, on=True):
    assert client.put("/api/pending-captures/settings", json={"auto_register": on}).json()["auto_register"] is on


def test_register_on_its_own_is_off_until_the_person_turns_it_on(api):
    client, _, waiting, _, memory = api
    assert client.get("/api/pending-captures/settings").json() == {"auto_register": False}
    r = capture(client, {"valor": "18,50", "descricao": "Mercado Ernesto", "carteira": "Nubank Roxinho"})
    assert r.json()["automatico"] is False and len(waiting) == 1


def _register(client, body, choice):
    capture(client, body)
    cid = next(i["id"] for i in client.get("/api/pending-captures").json()["items"] if i["name"] == body["descricao"])
    r = client.post(f"/api/pending-captures/{cid}/confirm", json=choice)
    assert r.status_code == 201, r.text
    return r


DEBIT = {"method": "debito", "account_id": "acc-it", "category_id": "cat-mkt"}


def test_three_debit_confirmations_in_a_row_let_it_register_on_its_own(api):
    client, data, waiting, log, memory = api
    _auto(client, memory)
    for i, name in enumerate(["MERCADO DO ERNESTO 0231", "Mercado do Ernesto", "PAG*Mercado do Ernesto"]):
        _register(client, {"valor": "20,00", "descricao": name, "carteira": "Itaú", "id": f"d{i}"}, DEBIT)
    r = capture(client, {"valor": "25,00", "descricao": "Mercado do Ernesto 77", "carteira": "Itaú", "id": "d3"})
    assert r.json()["automatico"] is True and "Desfazer" in r.json()["mensagem"] and "débito" in r.json()["mensagem"]
    made = [t for t in data["transactions"].docs if t["id"] == r.json()["id"]][0]
    assert (made["account_id"], made.get("card_id"), made["category_id"]) == ("acc-it", None, "cat-mkt")
    assert waiting == {} and memory["alerts"][-1][1] == "Registrado automaticamente: Mercado do Ernesto 77"
    auto = client.get("/api/pending-captures").json()["auto"]
    assert len(auto) == 1 and auto[0]["account_name"] == "Itaú" and auto[0]["transaction_id"] == made["id"]


def test_undo_takes_it_back_to_pending_and_forgets_the_combination(api):
    client, data, waiting, _, memory = api
    _auto(client, memory)
    for i in range(3):
        _register(client, {"valor": "20,00", "descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": f"d{i}"}, DEBIT)
    r = capture(client, {"valor": "21,00", "descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": "d3"})
    entry = client.get("/api/pending-captures").json()["auto"][0]
    assert client.post(f"/api/pending-captures/auto/{entry['id']}/undo").json()["ok"] is True
    assert not any(t["id"] == r.json()["id"] for t in data["transactions"].docs)
    body = client.get("/api/pending-captures").json()
    assert body["auto"] == [] and [i["name"] for i in body["items"]] == ["Mercado do Ernesto"]
    # Learned again from zero: the next one waits.
    assert capture(client, {"valor": "21,00", "descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": "d4"}).json()["automatico"] is False


def test_ok_keeps_the_automatic_one_and_clears_it_from_the_list(api):
    client, data, _, _, memory = api
    _auto(client, memory)
    for i in range(3):
        _register(client, {"valor": "20,00", "descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": f"d{i}"}, DEBIT)
    r = capture(client, {"valor": "21,00", "descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": "d3"})
    entry = client.get("/api/pending-captures").json()["auto"][0]
    assert client.delete(f"/api/pending-captures/auto/{entry['id']}").status_code == 204
    assert client.get("/api/pending-captures").json()["auto"] == []
    assert any(t["id"] == r.json()["id"] for t in data["transactions"].docs)


@pytest.mark.parametrize("credit_last, body", [
    (True, {"valor": "20,00"}),                          # the last one was crédito
    (False, {"valor": "90,00"}),                         # far above the usual 20
    (False, {"valor": "20,00", "data": "2099-01-01"}),   # in the future
])
def test_credit_unusual_values_and_future_dates_always_wait(api, credit_last, body):
    client, data, waiting, _, memory = api
    for i in range(3):
        _register(client, {"valor": "20,00", "descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": f"d{i}"}, DEBIT)
    if credit_last:
        _register(client, {"valor": "20,00", "descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": "c1"},
                  {"method": "credito", "card_id": "card-nu", "category_id": "cat-mkt"})
    _auto(client, memory)
    r = capture(client, {"descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": "d9", **body})
    assert r.json()["automatico"] is False and len(waiting) == 1


@pytest.mark.parametrize("body", [
    {"valor": "5,00", "descricao": "Loja Nova", "carteira": "Nubank Roxinho"},      # merchant never seen
    {"valor": "5,00", "descricao": "Mercado Ernesto", "carteira": "Refeição Pass"},  # wallet not registered
    {"valor": "5,00", "descricao": "Mercado Ernesto", "carteira": "Nubank Roxinho"},  # known by name, never confirmed
])
def test_anything_not_yet_learned_still_waits(api, body):
    client, data, waiting, _, memory = api
    _auto(client, memory)
    r = capture(client, body)
    assert r.status_code == 201 and r.json()["automatico"] is False
    assert len(waiting) == 1 and len(data["transactions"].docs) == 1


# --- débito or crédito, and what FINNOS learns ---------------------------------

def test_debit_is_the_default_and_comes_out_of_the_account_right_away(api):
    client, data, *_ = api
    capture(client, {"valor": "18,50", "descricao": "Padaria", "carteira": "Nubank Roxinho"})
    item = client.get("/api/pending-captures").json()["items"][0]
    # A card named like this exists, but débito is still the default: its paying account is pre-filled.
    assert (item["suggested_method"], item["suggested_account_id"], item["suggested_card_id"]) == ("debito", "acc-nu", "card-nu")
    assert client.post(f"/api/pending-captures/{item['id']}/confirm", json={"method": "debito"}).status_code == 201
    made = data["transactions"].docs[-1]
    assert (made["account_id"], made.get("card_id"), made.get("installment")) == ("acc-nu", None, False)
    assert "Débito" in made["notes"]


def test_credit_goes_on_the_card_in_installments(api):
    client, data, *_ = api
    capture(client, {"valor": "300,00", "descricao": "Loja", "carteira": "Nubank Roxinho"})
    cid = _first_id(client)
    r = client.post(f"/api/pending-captures/{cid}/confirm", json={"method": "credito", "installments": 3})
    assert r.status_code == 201
    made = data["transactions"].docs[-1]
    assert (made["card_id"], made["account_id"], made["total_installments"]) == ("card-nu", "acc-nu", 3)


@pytest.mark.parametrize("choice, words", [
    ({"method": "credito"}, "escolha o cartão"),                              # no card named like that
    ({"method": "debito"}, "escolha a conta"),                                # no account to suggest
    ({"method": "debito", "account_id": "acc-it", "installments": 2}, "só no crédito"),
])
def test_a_method_without_its_wallet_is_refused_and_keeps_the_purchase(api, choice, words):
    client, data, waiting, *_ = api
    capture(client, {"valor": "10,00", "descricao": "Loja", "carteira": "Refeição Pass"})
    r = client.post(f"/api/pending-captures/{_first_id(client)}/confirm", json=choice)
    assert r.status_code == 422 and words in r.json()["detail"] and len(waiting) == 1


def test_the_category_is_learned_by_merchant_even_with_codes_in_the_name(api):
    client, *_ = api
    _register(client, {"valor": "10,00", "descricao": "PADARIA SAO JOAO 0042", "carteira": "Itaú", "id": "p1"},
              {"method": "debito", "category_id": "cat-food"})
    capture(client, {"valor": "12,00", "descricao": "Padaria São João", "carteira": "Itaú", "id": "p2"})
    item = client.get("/api/pending-captures").json()["items"][0]
    assert (item["suggested_category_id"], item["learned_category"]) == ("cat-food", True)
    # Corrected once: the new category wins from then on.
    client.post(f"/api/pending-captures/{item['id']}/confirm", json={"method": "debito", "category_id": "cat-mkt"})
    capture(client, {"valor": "12,00", "descricao": "PADARIA SAO JOAO 0099", "carteira": "Itaú", "id": "p3"})
    assert client.get("/api/pending-captures").json()["items"][0]["suggested_category_id"] == "cat-mkt"


def test_the_wallet_chosen_for_an_unregistered_card_name_is_pre_filled_next_time(api):
    client, *_ = api
    _register(client, {"valor": "10,00", "descricao": "Almoço", "carteira": "Refeição Pass", "id": "v1"},
              {"method": "debito", "account_id": "acc-it"})
    capture(client, {"valor": "12,00", "descricao": "Lanche", "carteira": "Refeição Pass", "id": "v2"})
    item = client.get("/api/pending-captures").json()["items"][0]
    assert (item["suggested_method"], item["suggested_account_id"], item["learned_wallet"]) == ("debito", "acc-it", True)
    # Crédito is learned separately and never changes the débito default.
    client.post(f"/api/pending-captures/{item['id']}/confirm", json={"method": "credito", "card_id": "card-nu"})
    capture(client, {"valor": "12,00", "descricao": "Lanche", "carteira": "Refeição Pass", "id": "v3"})
    item = client.get("/api/pending-captures").json()["items"][0]
    assert (item["suggested_method"], item["suggested_account_id"], item["suggested_card_id"]) == ("debito", "acc-it", "card-nu")


# --- account and card with the same name ------------------------------------------

def test_a_name_that_is_both_an_account_and_a_card_asks_debit_or_credit(api):
    client, data, waiting, _, memory = api
    capture(client, {"valor": "30,00", "descricao": "Mercado do Ernesto", "carteira": "Nubank"})
    item = client.get("/api/pending-captures").json()["items"][0]
    # Both answers are ready, one tap each; neither is assumed.
    assert (item["ambiguous"], item["suggested_account_id"], item["suggested_card_id"]) == (True, "acc-nu", "card-nu")
    assert client.post("/api/pending-captures/confirm-all").json()["registered"] == 0
    # Never automatic, however many times it was confirmed in débito.
    for i in range(3):
        _register(client, {"valor": "20,00", "descricao": "Mercado do Ernesto", "carteira": "Nubank", "id": f"n{i}"},
                  {"method": "debito", "account_id": "acc-nu", "category_id": "cat-mkt"})
    _auto(client, memory)
    assert capture(client, {"valor": "20,00", "descricao": "Mercado do Ernesto", "carteira": "Nubank", "id": "n9"}).json()["automatico"] is False


def test_a_unique_name_is_not_ambiguous(api):
    client, *_ = api
    capture(client, {"valor": "9,90", "descricao": "Café", "carteira": "Itaú"})
    assert client.get("/api/pending-captures").json()["items"][0]["ambiguous"] is False


# --- unusual values and marking what came from Apple Pay ------------------------------

def test_with_the_unusual_value_hold_off_a_big_purchase_is_registered_and_marked(api):
    client, data, waiting, _, memory = api
    for i in range(3):
        _register(client, {"valor": "20,00", "descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": f"d{i}"}, DEBIT)
    assert client.put("/api/pending-captures/settings", json={"auto_register": True, "hold_unusual": False}).json()["hold_unusual"] is False
    r = capture(client, {"valor": "90,00", "descricao": "Mercado do Ernesto", "carteira": "Itaú", "id": "big"})
    assert r.json()["automatico"] is True and waiting == {}
    made = next(t for t in data["transactions"].docs if t["id"] == r.json()["id"])
    assert made["capture_auto"] is True and made["capture_unusual"] is True
    assert client.get("/api/pending-captures").json()["auto"][0]["unusual"] is True


def test_settings_change_only_what_is_sent(api):
    client, *_ = api
    client.put("/api/pending-captures/settings", json={"hold_unusual": False})
    assert client.put("/api/pending-captures/settings", json={"auto_register": True}).json() == {"auto_register": True, "hold_unusual": False}


def test_lancamentos_from_apple_pay_say_so():
    from finnos.routers.transactions import capture_origin
    base = {"source": "ios_shortcut", "operation_id": "pending:abc"}
    assert capture_origin(base) == "apple_pay"
    assert capture_origin({**base, "capture_auto": True}) == "apple_pay_auto"
    assert capture_origin({"source": "manual"}) is None
    assert capture_origin({"source": "ios_shortcut", "operation_id": "x"}) is None


def test_merchant_names_are_normalized():
    key = pending.merchant_key
    assert key("MERCADO DO ERNESTO 0231") == key("Mercado do Ernesto") == key("PAG*Mercado do Ernesto") == "mercado do ernesto"
    assert key("Padaria São João LTDA") == "padaria sao joao"
    assert key("7-Eleven") == "eleven" and key("") == ""


# --- telling the person -------------------------------------------------------

def test_a_new_pending_purchase_sends_one_alert_and_a_repeat_sends_none(api):
    client, _, _, _, memory = api
    body = {"valor": "4,99", "descricao": "Mercado", "carteira": "Refeição Pass", "id": "w-1"}
    capture(client, body)
    capture(client, body)
    assert len(memory["alerts"]) == 1
    _, title, text = memory["alerts"][0]
    assert title == "Compra pendente: Mercado" and "não está cadastrado" in text and "4,99" not in title + text  # amount stays off the lock screen


def test_no_alert_when_the_person_turned_push_off(api):
    client, data, _, _, memory = api
    data["notification_preferences"].docs.append({"user_id": "alice", "id": "prefs", "push_enabled": False})
    capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Itaú"})
    assert memory["alerts"] == []


def test_a_purchase_waiting_for_days_is_flagged_and_a_fresh_one_is_not():
    from datetime import datetime, timedelta, timezone
    now = datetime(2026, 11, 9, 12, tzinfo=timezone.utc)
    assert pending.waiting_days(now - timedelta(days=5, hours=3), now) == 5
    assert pending.waiting_days(now - timedelta(hours=3), now) == 0
    assert pending.waiting_days(None, now) == 0
    assert pending.waiting_days(datetime(2026, 11, 1), now) == 8  # naive timestamps are read as UTC


def test_a_forgotten_purchase_says_how_long_it_has_been_waiting(api):
    from datetime import datetime, timedelta, timezone
    client, _, waiting, *_ = api
    capture(client, {"valor": "4,99", "descricao": "Mercado", "carteira": "Itaú"})
    for doc in waiting.values():
        doc["created_at"] = datetime.now(timezone.utc) - timedelta(days=4, hours=1)
    item = client.get("/api/pending-captures").json()["items"][0]
    assert item["waiting_days"] == 4 and item["stale"] is True
    note = asyncio.run(notifications._pending_items("alice", set()))[0].description
    assert "Pendente há 4 dias" in note


def test_the_fields_the_automation_guide_tells_people_to_send_are_the_ones_the_server_reads():
    """src/lib/shortcutLinks.ts AUTOMATION_FIELDS must match the endpoint."""
    import re
    from pathlib import Path
    guide = (Path(__file__).resolve().parents[2] / "src/lib/shortcutLinks.ts").read_text()
    sent = re.findall(r'key: "(\w+)"', guide)
    assert sent == ["valor", "descricao", "carteira"]
    assert set(sent) <= set(shortcuts.PendenteIn.model_fields)


def test_benefit_card_matches_by_words_in_common():
    from finnos.lib.pending_captures import find_wallet
    accounts = [{"id": "a1", "name": "Nubank"}, {"id": "a2", "name": "VR Refeição"}, {"id": "a3", "name": "Alelo Alimentação"}]
    assert find_wallet("Pluxee Refeição", accounts)["id"] == "a2"
    assert find_wallet("PLUXEE REFEICAO", accounts)["id"] == "a2"
    # Only generic words in common: never guessed.
    assert find_wallet("Cartão de Crédito", accounts) is None


def test_words_in_common_tie_is_not_a_guess():
    from finnos.lib.pending_captures import find_wallet
    accounts = [{"id": "a1", "name": "Refeição Pluxee"}, {"id": "a2", "name": "Refeição Ticket"}]
    assert find_wallet("Pluxee Refeição", accounts)["id"] == "a1"
    assert find_wallet("Refeição", accounts) is None
