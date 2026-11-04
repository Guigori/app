"""FIN-02: early/partial invoice payment must not freeze open purchases.

Tests use synthetic financial data and do not reach Firebase/Firestore.
"""
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.lib.invoices import (
    commitment, invoice_state, output, purchase_write_conflict,
)


def card():
    return {
        "id": "card",
        "name": "Cartão",
        "closing_day": 29,
        "due_day": 7,
        "invoice_cycles": {},
    }


def purchase(identifier, day, amount):
    return {
        "id": identifier,
        "name": f"Compra {identifier}",
        "card_id": "card",
        "account_id": "acc",
        "category_id": None,
        "type": "despesa",
        "date": day,
        "value": amount,
        "installment": False,
        "status": "pago",
    }


def settle_early(instance, txs, paid=4000):
    cycle = "2026-10-29"
    state = invoice_state(instance, txs, cycle)
    instance["invoice_cycles"][cycle] = {
        "items": list(state["items"]),
        "paid_cents": paid,
        "paid_at": "2026-10-05",
    }
    return cycle


def test_partial_payment_and_new_purchase_in_open_cycle():
    instance = card()
    original = purchase("first", "2026-10-01", 100)
    cycle = settle_early(instance, [original])
    second = purchase("second", "2026-10-20", 200)
    assert purchase_write_conflict(instance, second, "2026-10-20") is None

    # A later purchase must be visible without replacing the paid snapshot.
    state = invoice_state(instance, [original, second], cycle)
    assert (state["total_cents"], state["paid_cents"]) == (30000, 4000)
    assert {item["id"] for item in state["items"]} == {"first", "second"}
    assert output(state)["outstanding"] == 260
    assert commitment(instance, [original, second], cycle) == (26000, 0, 26000)
    assert len(instance["invoice_cycles"][cycle]["items"]) == 1


def test_an_early_full_payment_does_not_prevent_new_purchase():
    instance = card()
    first = purchase("first", "2026-10-01", 100)
    cycle = settle_early(instance, [first], paid=10000)
    extra = purchase("second", "2026-10-20", 50)
    state = invoice_state(instance, [first, extra], cycle)
    assert state["total_cents"] == 15000
    assert state["paid_cents"] == 10000
    assert state["paid"] is False
    assert commitment(instance, [first, extra], cycle) == (5000, 0, 5000)


def test_closed_paid_cycle_rejects_backdated_new_purchases():
    instance = card()
    first = purchase("first", "2026-10-01", 100)
    settle_early(instance, [first])
    retroactive = purchase("later", "2026-10-17", 50)
    assert purchase_write_conflict(instance, retroactive, "2026-11-01") is not None


def test_existing_purchase_cannot_be_edited_or_deleted_after_payment():
    instance = card()
    original = purchase("first", "2026-10-01", 100)
    settle_early(instance, [original])
    edited = {**original, "value": 5}
    assert purchase_write_conflict(instance, edited, "2026-10-20", original=original)
    assert purchase_write_conflict(instance, original, "2026-10-20", original=original)


def test_persisted_snapshot_stays_authoritative_and_new_lines_are_added():
    instance = card()
    original = purchase("first", "2026-10-01", 100)
    second = purchase("second", "2026-10-20", 200)
    cycle = settle_early(instance, [original])
    corrupted_edit = {**original, "value": 3}
    state = invoice_state(instance, [corrupted_edit, second], cycle)
    assert state["total_cents"] == 30000
    assert [item["purchase_cents"] for item in state["items"]] == [10000, 20000]
    assert commitment(instance, [corrupted_edit, second], cycle) == (26000, 0, 26000)


def test_existing_cycle_still_uses_existing_payment_allocation():
    from finnos.lib.invoice_payments import allocate_payment
    instance = card()
    initial = purchase("first", "2026-10-01", 100)
    second = purchase("second", "2026-10-20", 200)
    cycle = settle_early(instance, [initial])
    state = invoice_state(instance, [initial, second], cycle)
    allocation = allocate_payment(state["total_cents"], [state["paid_cents"]], 5000)
    assert allocation["paid_cents"] == 9000
    assert allocation["outstanding_cents"] == 21000
    with pytest.raises(ValueError):
        allocate_payment(state["total_cents"], [state["paid_cents"]], 27000)


def test_validate_refs_accepts_new_open_cycle_purchase_but_guards_edits(monkeypatch):
    from finnos.lib import db as store
    instance = card()
    original = purchase("first", "2026-10-01", 100)
    settle_early(instance, [original])
    new = purchase("second", "2026-10-20", 200)

    class Ref:
        exists = True

        def get(self, transaction=None):
            return self

    class Parent:
        def collection(self, name):
            return self

        def document(self, identifier):
            return Ref()

    monkeypatch.setattr(store, "rows", lambda db, uid, name, transaction: [instance] if name == "cards" else [])
    monkeypatch.setattr(store, "root", lambda db, uid: Parent())
    monkeypatch.setattr("finnos.lib.dates.today_iso", lambda: "2026-10-20")
    store.validate_refs(object(), "uid", "transactions", new, object())
    with pytest.raises(HTTPException) as denied:
        store.validate_refs(object(), "uid", "transactions", original, object(), original_tx=original)
    assert denied.value.status_code == 409

    monkeypatch.setattr("finnos.lib.dates.today_iso", lambda: "2026-11-01")
    with pytest.raises(HTTPException) as closed:
        store.validate_refs(object(), "uid", "transactions", new, object())
    assert closed.value.status_code == 409
