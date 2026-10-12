"""Real HTTP contracts and ownership rules, without importing MongoDB."""

import copy
import importlib
from decimal import Decimal
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from finnos.lib import db as store
from finnos.lib.money import installment_portion

api = importlib.import_module("api.index")


class Snapshot:
    def __init__(self, identifier, doc):
        self.id, self.doc, self.exists = identifier, copy.deepcopy(doc), doc is not None

    def to_dict(self):
        return copy.deepcopy(self.doc)


class Ref:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def collection(self, name):
        return Collection(self.db, self.path + (name,))

    def get(self, transaction=None):
        return Snapshot(self.path[-1], self.db.data.get(self.path))


class Collection:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def document(self, name):
        return Ref(self.db, self.path + (name,))

    def limit(self, value):
        return self

    def stream(self, **kwargs):
        return [
            Snapshot(path[-1], doc)
            for path, doc in self.db.data.items()
            if path[:-1] == self.path
        ]


class Transaction:
    def __init__(self, db):
        self.db = db

    def create(self, ref, doc):
        assert ref.path not in self.db.data
        self.db.data[ref.path] = copy.deepcopy(doc)

    def set(self, ref, doc):
        self.db.data[ref.path] = copy.deepcopy(doc)

    def delete(self, ref):
        self.db.data.pop(ref.path, None)


class DB:
    def __init__(self):
        self.data = {}

    def collection(self, name):
        return Collection(self, (name,))


@pytest.fixture
def finance(monkeypatch):
    db = DB()
    monkeypatch.setenv("VERCEL_ENV", "preview")
    monkeypatch.setenv("APP_TZ", "America/Sao_Paulo")
    monkeypatch.setattr(store, "client", lambda: db)

    def atomic(db, uid, action):
        before = copy.deepcopy(db.data)
        try:
            return action(Transaction(db))
        except Exception:
            db.data = before
            raise

    monkeypatch.setattr(store, "atomic", atomic)
    active = {"uid": "test-a", "email": "a@example.invalid", "email_verified": True}
    monkeypatch.setattr(api, "verified_claims", lambda *args, **kwargs: dict(active))
    from finnos.routers import auth as financial_auth

    monkeypatch.setattr(financial_auth, "verify", lambda *args, **kwargs: dict(active))
    with TestClient(
        api.app,
        base_url="https://preview.example.com",
        headers={"Origin": "https://preview.example.com"},
    ) as client:
        client.cookies.set(api.COOKIE, "verified-session")
        yield client, active, db


def account(client, name="Conta", value=100):
    r = client.post("/api/accounts", json={"name": name, "initial_balance": value})
    assert r.status_code == 201, r.text
    return r.json()


def tx(client, account_id, **fields):
    data = dict(
        name="Salário",
        value=20.10,
        type="receita",
        status="pago",
        date="2026-10-12",
        account_id=account_id,
    )
    data.update(fields)
    return client.post("/api/transactions", json=data)


def test_empty_user_is_real_empty_not_demo(finance):
    client, _, _ = finance
    assert client.get("/api/accounts").json() == []
    assert client.get("/api/transactions").json() == []
    dashboard = client.get("/api/dashboard?month=2026-10").json()
    assert (
        dashboard["total_balance"] == dashboard["income"] == dashboard["expense"] == 0
    )
    assert dashboard["recent"] == [] and dashboard["prev_income"] is None


def test_cent_storage_transfer_and_paid_status(finance):
    client, _, db = finance
    a, b = account(client), account(client, "Destino", 10)
    assert tx(client, a["id"]).status_code == 201
    assert tx(client, a["id"], type="despesa", value=5.05).status_code == 201
    assert (
        tx(
            client, a["id"], type="transferencia", to_account_id=b["id"], value=25
        ).status_code
        == 201
    )
    assert tx(client, a["id"], status="pendente", value=1000).status_code == 201
    assert tx(client, a["id"], status="agendado", value=1000).status_code == 201
    balances = {x["name"]: x["balance"] for x in client.get("/api/accounts").json()}
    assert balances == {"Conta": 90.05, "Destino": 35}
    d = client.get("/api/dashboard?month=2026-10").json()
    assert (d["income"], d["expense"], d["month_balance"], d["total_balance"]) == (
        20.1,
        5.05,
        15.05,
        125.05,
    )
    docs = [v for k, v in db.data.items() if k[-2] == "transactions"]
    assert docs[0]["value_cents"] == 2010 and all("value" not in x for x in docs)
    assert client.delete("/api/accounts/" + a["id"]).status_code == 409


def test_installments_conserve_total_and_do_not_double_count(finance):
    client, _, _ = finance
    a = account(client)
    assert (
        tx(
            client,
            a["id"],
            type="despesa",
            value=100,
            installment=True,
            total_installments=3,
            date="2026-09-12",
        ).status_code
        == 201
    )
    values = [
        client.get("/api/dashboard?month=" + m).json()["expense"]
        for m in ["2026-09", "2026-10", "2026-11", "2026-12"]
    ]
    assert values == [33.33, 33.33, 33.34, 0]
    assert sum(
        installment_portion({"value": Decimal("100"), "total_installments": 3}, n)
        for n in range(3)
    ) == Decimal("100")


def test_three_user_crud_and_foreign_reference_isolation(finance):
    client, active, db = finance
    resources = {}
    for i, uid in enumerate(["test-a", "test-b", "test-c"]):
        active["uid"] = uid
        a = account(client, uid, (i + 1) * 100)
        t = tx(client, a["id"], value=(i + 1) * 10).json()
        resources[uid] = (a, t)
    for uid, (a, t) in resources.items():
        active["uid"] = uid
        assert [x["id"] for x in client.get("/api/accounts").json()] == [a["id"]]
        assert [x["id"] for x in client.get("/api/transactions").json()] == [t["id"]]
        for other, (foreign, foreign_tx) in resources.items():
            if other == uid:
                continue
            assert client.get("/api/accounts/" + foreign["id"]).status_code == 404
            assert (
                client.put(
                    "/api/accounts/" + foreign["id"], json={"name": "Ataque"}
                ).status_code
                == 404
            )
            assert client.delete("/api/accounts/" + foreign["id"]).status_code == 404
            assert (
                client.delete("/api/transactions/" + foreign_tx["id"]).status_code
                == 404
            )
            assert (
                client.get("/api/transactions/" + foreign_tx["id"]).status_code == 404
            )
            assert tx(client, foreign["id"]).status_code == 400
            assert (
                tx(
                    client, a["id"], type="transferencia", to_account_id=foreign["id"]
                ).status_code
                == 400
            )
            payload = dict(
                name="Ataque",
                value=1,
                type="receita",
                date="2026-10-12",
                account_id=a["id"],
            )
            assert (
                client.put(
                    "/api/transactions/" + foreign_tx["id"], json=payload
                ).status_code
                == 404
            )
    assert len([k for k in db.data if k[-2] == "transactions"]) == 3


def test_mutations_require_origin_and_session(finance):
    client, _, db = finance
    assert (
        client.post(
            "/api/accounts",
            json={"name": "Ataque"},
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )
    client.cookies.clear()
    assert client.get("/api/accounts").status_code == 401
    assert client.post("/api/accounts", json={"name": "Ataque"}).status_code == 401
    assert db.data == {}


def test_payload_cannot_select_uid_or_bad_date(finance):
    client, _, _ = finance
    assert (
        client.post(
            "/api/accounts", json={"name": "Ataque", "user_id": "test-b"}
        ).status_code
        == 422
    )
    a = account(client)
    assert tx(client, a["id"], date="2026-02-31").status_code == 422
    assert (
        tx(
            client,
            a["id"],
            installment=True,
            total_installments=3,
            current_installment=4,
        ).status_code
        == 400
    )
    assert (
        tx(client, a["id"], type="transferencia", to_account_id=a["id"]).status_code
        == 400
    )
    assert (
        client.get("/api/accounts", headers={"X-FINNOS-User-ID": "test-b"}).status_code
        == 401
    )


def test_update_preserves_id_date_and_filter_contract(finance):
    client, _, _ = finance
    a = account(client)
    t = tx(client, a["id"]).json()
    payload = dict(
        name="Aluguel",
        value=50.55,
        type="despesa",
        date="2026-10-12",
        account_id=a["id"],
    )
    r = client.put("/api/transactions/" + t["id"], json=payload)
    assert (
        r.status_code == 200
        and r.json()["id"] == t["id"]
        and r.json()["created_at"] == t["created_at"]
    )
    assert (
        len(
            client.get(
                "/api/transactions?month=2026-10&type=despesa&search=alug"
            ).json()
        )
        == 1
    )
    assert client.get("/api/transactions?month=2026-11").json() == []
    calendar = client.get("/api/analytics/calendar?month=2026-10").json()
    assert calendar["expense"] == 50.55 and calendar["days"][0]["count"] == 1
    assert client.delete("/api/transactions/" + t["id"]).status_code == 204
    assert client.delete("/api/accounts/" + a["id"]).status_code == 204


def test_transaction_operation_id_is_idempotent(finance):
    client, _, db = finance
    a = account(client)
    payload = dict(
        name="Offline",
        value=0.10,
        type="receita",
        date="2026-10-12",
        account_id=a["id"],
    )
    headers = {"X-FINNOS-Operation-ID": "operation-1"}
    first = client.post("/api/transactions", json=payload, headers=headers)
    second = client.post("/api/transactions", json=payload, headers=headers)
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert len(client.get("/api/transactions").json()) == 1


def test_categories_dashboard_rule_and_adjusted_values(finance):
    client, _, _ = finance
    a = account(client)
    c = client.post(
        "/api/categories", json={"name": "Mercado", "group": "necessidades"}
    ).json()
    tx(client, a["id"], value=1000)
    t = tx(
        client,
        a["id"],
        type="despesa",
        value=12.35,
        adjusted_value=10.10,
        category_id=c["id"],
    ).json()
    assert t["value"] == 10.1
    d = client.get("/api/dashboard?month=2026-10").json()
    assert (
        d["categories"][0]["name"] == "Mercado" and d["categories"][0]["total"] == 10.1
    )
    assert d["rule"][0]["limit"] == 500 and d["rule"][0]["spent"] == 10.1
    assert client.delete("/api/categories/" + c["id"]).status_code == 409
    assert (
        client.get("/api/analytics/trends?months=3&end_month=2026-10").json()[
            "total_expense"
        ]
        == 10.1
    )
    assert client.get("/api/analytics/flow?month=2026-10").status_code == 200


def test_adapter_fails_closed_without_verified_scope():
    token = store.active_uid.set(None)
    try:
        with pytest.raises(Exception):
            store.db.accounts.find({"user_id": "test-a"})
    finally:
        store.active_uid.reset(token)
