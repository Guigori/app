"""FIN-05b/09: paid invoice bank reimbursement without invoice rewrite."""
import asyncio
from datetime import date

import pytest
from fastapi import HTTPException

from finnos.lib.invoice_refunds import validate_bank_refund, append_refund
from finnos.lib.invoices import invoice_state, output, commitment
from finnos.lib.competency import monthly_competency
from finnos.lib.money import D
from finnos.models.notify import BankRefundIn
from finnos.routers.cards import bank_refund_invoice


def card(paid=30000):
    original = {
        "id": "purchase", "name": "Compra", "date": "2026-09-20",
        "purchase_cents": 30000, "category_name": "Compras",
        "category_color": None, "installment_label": None,
    }
    return {
        "id": "card", "name": "Cartão", "closing_day": 29, "due_day": 7,
        "invoice_cycles": {"2026-09-29": {
            "items": [original], "paid_cents": paid, "paid_at": "2026-10-07",
        }},
    }


def purchase():
    return {
        "id": "purchase", "name": "Compra", "type": "despesa",
        "status": "pago", "date": "2026-09-20", "value": 300,
        "card_id": "card", "category_id": "shopping",
        "account_id": "bank", "installment": False,
    }


def test_bank_refund_preserves_paid_invoice_and_releases_no_extra_limit():
    instance, txs = card(), [purchase()]
    assert validate_bank_refund(instance, txs, "2026-09-29", "purchase", 10000)["paid"]
    append_refund(instance, {
        "id": "refund-1", "cycle": "2026-09-29",
        "purchase_id": "purchase", "account_id": "bank",
        "refund_cents": 10000, "date": "2026-10-26", "reason": "Produto devolvido",
    })
    invoice = output(invoice_state(instance, txs, "2026-09-29"))
    assert invoice["paid"] is True
    assert invoice["total"] == 300
    assert invoice["paid_amount"] == 300
    assert invoice["outstanding"] == 0
    assert invoice["refund_total"] == 100
    assert commitment(instance, txs, "2026-10-29") == (0, 0, 0)
    september = monthly_competency(txs, [instance], "2026-09")
    october = monthly_competency(txs, [instance], "2026-10")
    assert september["expense"] == D(300)
    assert october["expense"] == D(-100)
    assert october["by_category"]["shopping"] == D(-100)


def test_refund_rejects_non_settled_and_over_refund_and_same_id():
    instance, txs = card(paid=10000), [purchase()]
    with pytest.raises(ValueError, match="fatura quitada"):
        validate_bank_refund(instance, txs, "2026-09-29", "purchase", 10000)
    instance = card()
    append_refund(instance, {
        "id": "a", "cycle": "2026-09-29", "purchase_id": "purchase",
        "refund_cents": 25000, "date": "2026-10-26",
    })
    with pytest.raises(ValueError, match="ultrapassam"):
        validate_bank_refund(instance, txs, "2026-09-29", "purchase", 5001)
    with pytest.raises(ValueError, match="já registrado"):
        append_refund(instance, {"id": "a", "cycle": "2026-09-29"})


def test_refund_handler_idempotent_and_cash_only(monkeypatch):
    from finnos.lib import db as store

    original = card()
    purchases = [purchase()]
    recorded = {}

    class Snap:
        exists = True
        def __init__(self, ref):
            self.ref = ref
        def to_dict(self):
            return dict(self.ref.doc)

    class Ref:
        def __init__(self, name, doc=None):
            self.name = name
            self.doc = doc or {}
        def get(self, transaction=None):
            return Snap(self)

    cardref = Ref("card", original)
    bankref = Ref("bank", {"id": "bank"})

    class Collection:
        def __init__(self, name):
            self.name = name
        def document(self, key):
            return cardref if self.name == "cards" else bankref if self.name == "accounts" else Ref(f"{self.name}:{key}")

    class Owner:
        def collection(self, name):
            return Collection(name)

    class Tx:
        def create(self, ref, doc):
            if ref.name in recorded:
                raise AssertionError("duplicate bank receipt")
            recorded[ref.name] = doc
        def update(self, ref, values):
            ref.doc.update(values)

    monkeypatch.setattr(store, "scoped", lambda q: "uid")
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Owner())
    monkeypatch.setattr(store, "rows", lambda db, uid, name, tr: purchases if name == "transactions" else [])
    monkeypatch.setattr(store, "card_purchase_rows", lambda db, uid, card_id, tr: purchases)
    monkeypatch.setattr(store, "atomic", lambda db, uid, action: action(Tx()))
    input = BankRefundIn(cycle="2026-09-29", purchase_id="purchase",
                         account_id="bank", date="2026-10-26", value=100,
                         reason="Produto devolvido")
    first = asyncio.run(bank_refund_invoice(
        "card", input, user={"id": "uid"}, x_finnos_operation_id="refund-1"
    ))
    assert first["paid"] is True
    assert first["refund_total"] == 100
    assert len([key for key in recorded if key.startswith("transactions:")]) == 1
    bank_transaction = next(value for key, value in recorded.items() if key.startswith("transactions:"))
    assert bank_transaction["invoice_refund"]
    assert bank_transaction["type"] == "receita"
    assert bank_transaction["value_cents"] == 10000
    assert len(original["invoice_refunds"]["2026-09-29"]) == 1
    second = asyncio.run(bank_refund_invoice(
        "card", input, user={"id": "uid"}, x_finnos_operation_id="refund-1"
    ))
    assert second["refund_total"] == 100
    assert len([key for key in recorded if key.startswith("transactions:")]) == 1
    with pytest.raises(HTTPException) as reused:
        asyncio.run(bank_refund_invoice(
            "card", input.model_copy(update={"value": 90}),
            user={"id": "uid"}, x_finnos_operation_id="refund-1"
        ))
    assert reused.value.status_code == 409
