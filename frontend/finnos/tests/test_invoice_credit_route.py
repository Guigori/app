import asyncio
"""FIN-05 HTTP handler behavior with synthetic transactional Firestore fakes.

No Firebase credentials, Firestore rules or real user data are touched.
"""
import copy

import pytest
from fastapi import HTTPException

from finnos.models.notify import CreditInvoiceIn
from finnos.routers.cards import credit_invoice


class CardSnapshot:
    exists = True

    def __init__(self, record):
        self.record = record

    def to_dict(self):
        return copy.deepcopy(self.record)


class CardRef:
    def __init__(self, record):
        self.record = record

    def get(self, transaction=None):
        return CardSnapshot(self.record)


class Collection:
    def __init__(self, ref):
        self.ref = ref

    def document(self, key):
        assert key == "card"
        return self.ref


class Owner:
    def __init__(self, ref):
        self.ref = ref

    def collection(self, name):
        assert name == "cards"
        return Collection(self.ref)


class Transaction:
    def update(self, ref, payload):
        ref.record.update(copy.deepcopy(payload))


def fixture(monkeypatch, *, paid=0):
    from finnos.lib import db as store

    initial = {
        "id": "card", "name": "Cartão", "closing_day": 29,
        "due_day": 7, "invoice_cycles": {},
    }
    if paid:
        initial["invoice_cycles"]["2026-10-29"] = {
            "items": [{
                "id": "purchase", "name": "Notebook", "date": "2026-10-20",
                "purchase_cents": 30000, "category_name": None,
                "category_color": None, "installment_label": None,
            }],
            "paid_cents": paid, "paid_at": "2026-10-24",
        }
    ref = CardRef(initial)
    owner = Owner(ref)
    txs = [{
        "id": "purchase", "name": "Notebook", "date": "2026-10-20",
        "card_id": "card", "type": "despesa", "value": 300,
        "status": "pago", "installment": False,
    }]
    monkeypatch.setattr(store, "scoped", lambda query: "uid")
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda instance, uid: owner)
    monkeypatch.setattr(store, "rows", lambda instance, uid, name, tr: txs if name == "transactions" else [])
    monkeypatch.setattr(store, "atomic", lambda instance, uid, action: action(Transaction()))
    return initial


def credit(value=100, reason="Produto devolvido"):
    return CreditInvoiceIn(cycle="2026-10-29", purchase_id="purchase", value=value, reason=reason)


def test_credit_handler_is_atomic_and_retry_safe(monkeypatch):
    record = fixture(monkeypatch, paid=4000)
    first = asyncio.run(credit_invoice("card", credit(100), user={"id": "uid"}, x_finnos_operation_id="op-1"))
    assert first["total"] == 200
    assert first["paid_amount"] == 40
    assert first["outstanding"] == 160
    assert first["adjustment_total"] == 100
    assert len(record["invoice_adjustments"]["2026-10-29"]) == 1
    second = asyncio.run(credit_invoice("card", credit(100), user={"id": "uid"}, x_finnos_operation_id="op-1"))
    assert second["outstanding"] == 160
    assert len(record["invoice_adjustments"]["2026-10-29"]) == 1
    with pytest.raises(HTTPException) as reuse:
        asyncio.run(credit_invoice("card", credit(110), user={"id": "uid"}, x_finnos_operation_id="op-1"))
    assert reuse.value.status_code == 409


def test_paid_invoice_disallows_credit_without_bank_refund(monkeypatch):
    record = fixture(monkeypatch, paid=30000)
    with pytest.raises(HTTPException) as denied:
        asyncio.run(credit_invoice("card", credit(), user={"id": "uid"}, x_finnos_operation_id="paid"))
    assert denied.value.status_code == 409
    assert not record.get("invoice_adjustments")


def test_credit_handler_avoids_duplicate_account_or_purchase_writes(monkeypatch):
    record = fixture(monkeypatch)
    output = asyncio.run(credit_invoice("card", credit(300), user={"id": "uid"}, x_finnos_operation_id="zero"))
    assert output["total"] == 0
    assert output["outstanding"] == 0
    assert output["items"][0]["value"] == 300
    assert len(record["invoice_adjustments"]["2026-10-29"]) == 1
