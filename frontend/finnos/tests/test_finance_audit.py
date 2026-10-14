"""Contract tests for Firestore financial completeness diagnostics."""
from copy import deepcopy
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from finnos.lib.finance_audit import KINDS, audit_finance
from finnos.routers import finance_validation
from finnos.routers.auth import require_user


def records():
    data = {kind: [] for kind in KINDS}
    data["accounts"] = [
        {"id": "a", "initial_balance": 100, "name": "Conta"},
        {"id": "b", "initial_balance": 20, "name": "Destino"},
    ]
    data["categories"] = [{"id": "food"}]
    data["cards"] = [{"id": "card", "payment_account_id": "a"}]
    data["transactions"] = [
        {"id": "income", "account_id": "a", "value": 50,
         "status": "pago", "type": "receita", "date": "2026-01-01"},
        {"id": "transfer", "account_id": "a", "to_account_id": "b",
         "value": 25, "status": "pago", "type": "transferencia", "date": "2026-01-03"},
        {"id": "card-purchase", "account_id": "a", "card_id": "card",
         "category_id": "food", "value": 30,
         "status": "pago", "type": "despesa", "date": "2026-01-04"},
    ]
    data["goals"] = [{"id": "goal", "account": "b"}]
    data["budget_cycles"] = [{"id": "plan", "allocations": [{"category_id": "food"}]}]
    return data


def test_integrity_and_total_do_not_double_charge_credit_card():
    result = audit_finance(records())
    assert result["integrity_ok"] is True
    assert result["issues"] == {}
    assert result["total_account_balance"] == 170.0
    assert result["legacy_reconciliation"] == "not_verified"


def test_orphans_block_balance_confirmation():
    data = records()
    data["transactions"].append({
        "id": "bad", "account_id": "another-users-account",
        "value": 5, "status": "pago", "type": "despesa", "date": "2026-01-01"})
    data["goals"].append({"id": "bad-goal", "account": "another-users-account"})
    result = audit_finance(data)
    assert result["integrity_ok"] is False
    assert result["issues"]["transaction_source_account_missing"] == 1
    assert result["issues"]["goal_account_missing"] == 1
    assert result["total_account_balance"] is None


class Query:
    def __init__(self, kind, uid, stored):
        self.kind, self.uid, self.stored = kind, uid, stored

    async def to_list(self, maximum):
        assert self.uid == "uid-owner"
        return deepcopy(self.stored[self.uid][self.kind][:maximum])


class Collection:
    def __init__(self, kind, stored):
        self.kind, self.stored = kind, stored

    def find(self, query):
        return Query(self.kind, query["user_id"], self.stored)


def test_validation_endpoint_only_queries_authenticated_uid(monkeypatch):
    stored = {
        "uid-owner": records(),
        "uid-other": {k: [{"id": "secret"}] for k in KINDS},
    }
    fake_db = SimpleNamespace(**{
        kind: Collection(kind, stored) for kind in KINDS
    })
    monkeypatch.setattr(finance_validation, "db", fake_db)
    app = FastAPI()
    app.include_router(finance_validation.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": "uid-owner"}
    with TestClient(app) as client:
        response = client.get("/api/finance/integrity")
    assert response.status_code == 200, response.text
    assert response.json()["counts"]["accounts"] == 2
    assert response.json()["integrity_ok"] is True
