"""FIN-01/02: partial and repeated invoice payments on card-scoped atomic reads.

Synthetic Firestore transaction. Validates idempotency and that purchases
added after an early payment remain visible without phantom bank debits.
"""
import asyncio
import copy
from decimal import Decimal

from finnos.lib import db as store
from finnos.models.notify import PayInvoiceIn
from finnos.routers.cards import pay_invoice


class Ref:
    def __init__(self, name, data=None):
        self.name = name
        self.data = copy.deepcopy(data)

    def get(self, transaction=None):
        parent = self
        return type("Snap", (), {
            "exists": parent.data is not None,
            "to_dict": lambda self: copy.deepcopy(parent.data),
        })()


def fixture(monkeypatch):
    card = Ref("cards:card", {
        "id": "card", "name": "Cartão",
        "closing_day": 29, "due_day": 7, "invoice_cycles": {},
    })
    bank = Ref("accounts:bank", {"id": "bank"})
    receipts = {}
    payments = {}
    events = []
    purchases = [{
        "id": "first", "name": "Primeira compra",
        "date": "2026-10-10", "value": Decimal("100.00"),
        "card_id": "card", "type": "despesa",
        "status": "pago", "installment": False,
    }]
    calls = []

    class Owner:
        def collection(self, name):
            if name == "cards":
                return type("Coll", (), {"document": lambda self, key: card})()
            if name == "accounts":
                return type("Coll", (), {"document": lambda self, key: bank})()
            if name == "invoice_payments":
                return type("Coll", (), {"document": lambda self, key: receipts.setdefault(
                    key, Ref("invoice_payments:" + key)
                )})()
            if name == "transactions":
                return type("Coll", (), {"document": lambda self, key: payments.setdefault(
                    key, Ref("transactions:" + key)
                )})()
            if name == "finance_history":
                return type("Coll", (), {"document": lambda self, key: Ref("history:" + key)})()
            raise AssertionError("Unexpected collection " + name)

    class Tx:
        def create(self, ref, value):
            if ref.data is not None:
                raise AssertionError("Duplicate financial operation")
            ref.data = copy.deepcopy(value)
            events.append((ref.name, copy.deepcopy(value)))

        def set(self, ref, value):
            ref.data = copy.deepcopy(value)

    monkeypatch.setattr(store, "scoped", lambda query: "uid")
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Owner())
    monkeypatch.setattr(store, "atomic", lambda db, uid, fn: fn(Tx()))
    def card_rows(db, uid, card_id, transaction):
        assert (uid, card_id) == ("uid", "card")
        calls.append(card_id)
        return purchases

    monkeypatch.setattr(store, "card_purchase_rows", card_rows)
    monkeypatch.setattr(store, "rows", lambda db, uid, kind, transaction: []
                       if kind == "categories" else (_ for _ in ()).throw(
                           AssertionError("global transaction scan used")
                       ))
    return card, purchases, events, calls


def test_partial_payment_retry_and_late_purchase_are_consistent(monkeypatch):
    card, purchases, events, calls = fixture(monkeypatch)
    first_input = PayInvoiceIn(
        cycle="2026-10-29", account_id="bank",
        date="2026-10-26", value=40,
    )
    first = asyncio.run(pay_invoice(
        "card", first_input, user={"id": "uid"},
        x_finnos_operation_id="op-first",
    ))
    assert (first["total"], first["paid_amount"], first["outstanding"]) == (
        100, 40, 60,
    )
    assert len([x for x in events if x[0].startswith("transactions:")]) == 1
    retry = asyncio.run(pay_invoice(
        "card", first_input, user={"id": "uid"},
        x_finnos_operation_id="op-first",
    ))
    assert retry == first
    assert len([x for x in events if x[0].startswith("transactions:")]) == 1

    # Open cycle: a late purchase must not overwrite the paid snapshot.
    purchases.append({
        "id": "second", "name": "Compra nova",
        "date": "2026-10-26", "value": Decimal("60.00"),
        "card_id": "card", "type": "despesa",
        "status": "pago", "installment": False,
    })
    final = asyncio.run(pay_invoice(
        "card", PayInvoiceIn(
            cycle="2026-10-29", account_id="bank",
            date="2026-10-26", value=120,
        ), user={"id": "uid"}, x_finnos_operation_id="op-second",
    ))
    assert (final["total"], final["paid_amount"], final["outstanding"]) == (
        160, 160, 0,
    )
    assert final["paid"] is True
    assert {item["id"] for item in final["items"]} == {"first", "second"}
    assert len([x for x in events if x[0].startswith("transactions:")]) == 2
    assert card.data["invoice_cycles"]["2026-10-29"]["paid_cents"] == 16000
    assert calls == ["card", "card"]
    assert all(item["value_cents"] > 0 for label, item in events
               if label.startswith("transactions:"))
