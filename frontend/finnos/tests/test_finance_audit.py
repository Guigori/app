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


def test_standalone_subscription_orphan_blocks_audited_balance():
    data = records()
    data["subscriptions"] = [{"id": "sub", "account_id": "missing-account",
                              "category_id": "food", "card_id": "card"}]
    audited = audit_finance(data)
    assert audited["integrity_ok"] is False
    assert audited["issues"]["subscription_account_missing"] == 1
    assert audited["total_account_balance"] is None



def with_refund_records():
    data = records()
    data["cards"][0]["invoice_refunds"] = {
        "2026-01-29": [{
            "id": "return-1", "purchase_id": "card-purchase",
            "account_id": "b", "date": "2026-01-09",
            "refund_cents": 1250, "reason": "Item devolvido",
        }],
    }
    data["transactions"].append({
        "id": "return-1", "type": "receita", "status": "pago",
        "date": "2026-01-09", "value": 12.50, "account_id": "b",
        "card_id": None, "invoice_refund": True, "invoice_card_id": "card",
        "invoice_cycle": "2026-01-29",
        "original_purchase_id": "card-purchase",
    })
    return data


def test_financial_integrity_links_card_refund_and_its_cash_receipt():
    data = with_refund_records()
    result = audit_finance(data)
    assert result["integrity_ok"] is True
    assert result["issues"] == {}
    assert result["total_account_balance"] == 182.50


def test_refund_without_its_bank_receipt_blocks_balance_confirmation():
    data = with_refund_records()
    data["transactions"] = [tx for tx in data["transactions"] if tx["id"] != "return-1"]
    result = audit_finance(data)
    assert result["issues"]["invoice_refund_receipt_missing_or_mismatch"] == 1
    assert result["total_account_balance"] is None


def test_wrong_refund_value_or_account_is_flagged():
    data = with_refund_records()
    receipt = data["transactions"][-1]
    receipt["value"] = "not-a-number"
    assert audit_finance(data)["issues"]["invoice_refund_receipt_missing_or_mismatch"] == 1
    receipt["value"] = 12.5
    receipt["account_id"] = "a"
    assert audit_finance(data)["issues"]["invoice_refund_receipt_missing_or_mismatch"] == 1


def test_refund_receipt_without_card_ledger_is_orphaned():
    data = with_refund_records()
    data["cards"][0].pop("invoice_refunds")
    assert audit_finance(data)["issues"]["invoice_refund_orphan_receipt"] == 1


def test_credit_references_must_match_purchase_on_same_card():
    data = records()
    data["cards"][0]["invoice_adjustments"] = {
        "2026-01-29": [
            {"id": "cr-1", "purchase_id": "missing", "credit_cents": 200},
            {"id": "cr-2", "purchase_id": "card-purchase", "credit_cents": -100},
        ],
    }
    issues = audit_finance(data)["issues"]
    assert issues["invoice_adjustment_original_missing"] == 1
    assert issues["invoice_adjustment_amount_invalid"] == 1


def test_duplicate_credit_identifier_is_detected():
    data = records()
    event = {"id": "cr-1", "purchase_id": "card-purchase", "credit_cents": 500}
    data["cards"][0]["invoice_adjustments"] = {
        "2026-01-29": [dict(event), dict(event)],
    }
    assert audit_finance(data)["issues"]["invoice_adjustment_duplicate_id"] == 1
