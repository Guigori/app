"""FIN-09/ARQ-06: authenticated evidence preview and push cron configuration.

Synthetic Firestore only; verifies that imported statements never modify
accounts, cards, transactions, or inferred invoice settlement.
"""
import asyncio
import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from finnos.lib.reconciliation_preview import compare_invoice_evidence, compare_account_evidence
from finnos.routers import finance_validation
from finnos.routers.auth import require_user


def scenario():
    return {
        "cards": [{"id": "card", "invoice_cycles": {
            "2026-09-29": {"paid_cents": 30000, "items": []},
        }}],
        "transactions": [{
            "id": "receipt", "invoice_payment": True,
            "invoice_card_id": "card", "invoice_cycle": "2026-09-29",
            "value": 300, "status": "pago", "type": "despesa",
        }],
    }


def test_matching_import_still_requires_original_bank_statement_verification():
    docs = scenario()
    before = deepcopy(docs)
    result = compare_invoice_evidence(docs["cards"], docs["transactions"], [{
        "card_id": "card", "cycle": "2026-09-29",
        "declared_invoice_total": 300, "declared_paid": 300,
    }])
    assert result["matched_count"] == 1
    assert result["items"][0]["status"] == "values_match_unverified"
    assert result["migration_reconciled"] is False
    assert result["external_statement_verified"] is False
    assert result["writes_data"] is False
    assert docs == before


def test_report_detects_missing_payment_and_unknown_card_without_inventing_money():
    docs = scenario()
    docs["transactions"] = []
    result = compare_invoice_evidence(docs["cards"], docs["transactions"], [
        {"card_id": "card", "cycle": "2026-09-29",
         "declared_invoice_total": 300, "declared_paid": 300},
        {"card_id": "elsewhere", "cycle": "2026-09-29",
         "declared_invoice_total": 1, "declared_paid": 0},
    ])
    assert result["review_count"] == 2
    assert "bank_receipts_differ" in result["items"][0]["differences"]
    assert result["items"][1]["status"] == "unknown_card"


def test_invalid_invoice_evidence_has_no_autocorrection():
    docs = scenario()
    report = compare_invoice_evidence(docs["cards"], docs["transactions"], [{
        "card_id": "card", "cycle": "2026-09-29",
        "declared_invoice_total": 100, "declared_paid": 300,
    }])
    assert "invalid_evidence_amounts" in report["items"][0]["differences"]
    assert report["matched_count"] == 0


def test_authenticated_route_limits_import_and_is_read_only(monkeypatch):
    data = scenario()
    calls = []
    class Cursor:
        def __init__(self, rows): self.rows = rows
        async def to_list(self, max_count): return deepcopy(self.rows)
    class Collection:
        def __init__(self, name): self.name = name
        def find(self, query):
            calls.append((self.name, dict(query)))
            return Cursor(data[self.name])
    monkeypatch.setattr(finance_validation, "db", SimpleNamespace(
        cards=Collection("cards"), transactions=Collection("transactions"),
    ))
    app = FastAPI()
    app.include_router(finance_validation.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": "account-A"}
    before = deepcopy(data)
    with TestClient(app) as client:
        response = client.post("/api/finance/reconciliation/preview", json={
            "invoices": [{
                "card_id": "card", "cycle": "2026-09-29",
                "declared_invoice_total": "300.00", "declared_paid": "300.00",
                "reference": "synthetic-bank-statement",
            }]
        })
        assert response.status_code == 200, response.text
        assert response.json()["writes_data"] is False
        assert client.post("/api/finance/reconciliation/preview", json={
            "invoices": [{"card_id": "card", "cycle": "2026-09-29",
                          "declared_invoice_total": 1, "declared_paid": 0}
                         for _ in range(101)]
        }).status_code == 422
    assert data == before
    assert all(query == {"user_id": "account-A"} for _, query in calls)


def test_vercel_has_no_unimplemented_dispatch_cron_and_exposes_reconciliation():
    path = Path(__file__).resolve().parents[2] / "vercel.json"
    config = json.loads(path.read_text(encoding="utf-8"))
    assert config.get("crons") == []
    assert not any("/api/push/dispatch" in str(c) for c in config.get("crons", []))
    assert "reconciliation/preview" in config["routes"][0]["src"]



def test_account_statement_reconciliation_tracks_actual_balance_without_writes():
    accounts = [{"id": "bank", "initial_balance": 1000},
                {"id": "savings", "initial_balance": 0}]
    transactions = [
        {"id": "salary", "type": "receita", "status": "pago",
         "date": "2026-10-01", "value": 300, "account_id": "bank"},
        {"id": "transfer", "type": "transferencia", "status": "pago",
         "date": "2026-10-10", "value": 100,
         "account_id": "bank", "to_account_id": "savings"},
        {"id": "scheduled", "type": "despesa", "status": "pendente",
         "date": "2026-10-26", "value": 99, "account_id": "bank"},
    ]
    before = deepcopy((accounts, transactions))
    evidence = [
        {"account_id": "bank", "statement_date": "2026-10-26",
         "statement_balance": 1200},
        {"account_id": "savings", "statement_date": "2026-10-26",
         "statement_balance": 200},
    ]
    report = compare_account_evidence(accounts, transactions, evidence)
    assert report["matched_count"] == 1
    assert report["review_count"] == 1
    assert report["items"][0]["difference_cents"] == 0
    assert report["items"][1]["recorded_cents"] == 10000
    assert report["items"][1]["difference_cents"] == -10000
    assert report["writes_data"] is False
    assert (accounts, transactions) == before


def test_account_only_preview_is_scoped_and_rejects_future_evidence(monkeypatch):
    data = {"accounts": [{"id": "bank", "initial_balance": 500}],
            "transactions": []}
    calls = []
    class Cursor:
        def __init__(self, rows): self.rows = rows
        async def to_list(self, maximum): return deepcopy(self.rows)
    class Collection:
        def __init__(self, name): self.name = name
        def find(self, query):
            calls.append((self.name, dict(query)))
            return Cursor(data[self.name])
    monkeypatch.setattr(finance_validation, "db", SimpleNamespace(
        accounts=Collection("accounts"),
        transactions=Collection("transactions"),
    ))
    monkeypatch.setattr(finance_validation, "today_iso", lambda: "2026-10-27")
    app = FastAPI()
    app.include_router(finance_validation.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": "A"}
    before = deepcopy(data)
    with TestClient(app) as client:
        correct = client.post("/api/finance/reconciliation/preview", json={
            "accounts": [{"account_id": "bank", "statement_date": "2026-10-26",
                          "statement_balance": "500.00"}],
        })
        assert correct.status_code == 200, correct.text
        assert correct.json()["accounts"]["matched_count"] == 1
        assert correct.json()["writes_data"] is False
        invalid = client.post("/api/finance/reconciliation/preview", json={
            "accounts": [{"account_id": "bank", "statement_date": "2026-12-01",
                          "statement_balance": 500}],
        })
        assert invalid.status_code == 422
        assert client.post("/api/finance/reconciliation/preview", json={}).status_code == 422
    assert data == before
    assert calls and all(query == {"user_id": "A"} for _, query in calls)
