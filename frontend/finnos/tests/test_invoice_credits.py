"""FIN-05 regression: append-only credits against unpaid card invoices."""
from datetime import date

import pytest
from fastapi import HTTPException

from finnos.lib.invoice_credits import append_credit, validate_credit
from finnos.lib.invoices import invoice_state, output, commitment, purchase_write_conflict, default_invoice_cycle
from finnos.lib.invoice_payments import allocate_payment


def card():
    return {
        "id": "card", "name": "Cartão", "closing_day": 29, "due_day": 7,
        "limit": 1000, "invoice_cycles": {},
    }


def purchase(id="a", amount=300, date="2026-10-20"):
    return {
        "id": id, "name": f"Compra {id}", "date": date,
        "card_id": "card", "type": "despesa", "status": "pago",
        "value": amount, "installment": False,
    }


def credit(instance, txs, value, original="a", cycle="2026-10-29", identifier="credit-1"):
    validate_credit(instance, txs, cycle, original, value)
    append_credit(instance, {
        "id": identifier, "cycle": cycle, "purchase_id": original,
        "date": "2026-10-26", "credit_cents": value,
        "reason": "Produto devolvido", "fingerprint": "abc",
    })


def test_credit_reduces_invoice_and_committed_limit_without_erasing_purchase():
    instance, txs = card(), [purchase()]
    credit(instance, txs, 10000)
    result = invoice_state(instance, txs, "2026-10-29")
    assert result["total_cents"] == 20000
    assert result["paid_cents"] == 0
    assert len(result["items"]) == 1
    assert len(result["adjustments"]) == 1
    assert output(result)["adjustment_total"] == 100
    assert output(result)["outstanding"] == 200
    assert commitment(instance, txs, "2026-10-29") == (20000, 0, 20000)


def test_partially_paid_cycle_credit_limited_by_outstanding():
    instance, txs = card(), [purchase()]
    state = invoice_state(instance, txs, "2026-10-29")
    instance["invoice_cycles"]["2026-10-29"] = {
        "items": state["items"], "paid_cents": 20000, "paid_at": "2026-10-25"
    }
    credit(instance, txs, 10000)
    resulting = invoice_state(instance, txs, "2026-10-29")
    assert resulting["total_cents"] == resulting["paid_cents"] == 20000
    assert resulting["paid"] is True
    assert commitment(instance, txs, "2026-10-29") == (0, 0, 0)
    with pytest.raises(ValueError, match="saldo não pago"):
        validate_credit(instance, txs, "2026-10-29", "a", 1)


def test_fully_paid_cycle_requires_explicit_bank_refund_flow():
    instance, txs = card(), [purchase()]
    instance["invoice_cycles"]["2026-10-29"] = {
        "items": invoice_state(instance, txs, "2026-10-29")["items"],
        "paid_cents": 30000, "paid_at": "2026-10-25",
    }
    with pytest.raises(ValueError, match="reembolso bancário"):
        validate_credit(instance, txs, "2026-10-29", "a", 100)
    assert not instance.get("invoice_adjustments")


def test_credit_amount_cannot_exceed_original_purchase_even_if_more_debt_exists():
    instance, txs = card(), [purchase("a", 100), purchase("b", 500)]
    with pytest.raises(ValueError, match="compra"):
        validate_credit(instance, txs, "2026-10-29", "a", 10001)
    with pytest.raises(ValueError, match="não encontrada"):
        validate_credit(instance, txs, "2026-10-29", "unknown", 100)
    with pytest.raises(ValueError):
        validate_credit(instance, txs, "2026-10-29", "a", -100)


def test_two_partial_credits_accumulate_without_exceeding_line_or_double_count():
    instance, txs = card(), [purchase("a", 100)]
    credit(instance, txs, 3500, identifier="one")
    credit(instance, txs, 1500, identifier="two")
    assert invoice_state(instance, txs, "2026-10-29")["total_cents"] == 5000
    with pytest.raises(ValueError, match="compra"):
        validate_credit(instance, txs, "2026-10-29", "a", 5001)
    with pytest.raises(ValueError, match="já registrado"):
        append_credit(instance, {
            "id": "one", "cycle": "2026-10-29", "purchase_id": "a", "credit_cents": 1,
        })


def test_credit_immutability_is_enforced_during_purchase_edit_or_delete():
    instance, txs = card(), [purchase()]
    credit(instance, txs, 4000)
    assert "estorno auditado" in purchase_write_conflict(
        instance, txs[0], "2026-10-26", original=txs[0]
    )


def test_saved_payment_items_stay_authoritative_after_credit_and_later_purchase():
    instance = card()
    old, new = purchase("a", 300), purchase("b", 100, "2026-10-24")
    saved = invoice_state(instance, [old], "2026-10-29")
    instance["invoice_cycles"]["2026-10-29"] = {
        "items": saved["items"], "paid_cents": 4000, "paid_at": "2026-10-21",
    }
    credit(instance, [old, new], 6000, original="a")
    state = invoice_state(instance, [old, new], "2026-10-29")
    assert state["total_cents"] == 34000
    assert state["paid_cents"] == 4000
    assert len(state["items"]) == 2
    assert len(state["adjustments"]) == 1
    assert commitment(instance, [old, new], "2026-10-29") == (30000, 0, 30000)
    allocation = allocate_payment(state["total_cents"], [state["paid_cents"]], 30000)
    assert allocation["settled"]


def test_oldest_unpaid_closed_invoice_selection_respects_credit_notes():
    instance, txs = card(), [purchase(date="2026-09-20")]
    credit(instance, txs, 30000, cycle="2026-09-29")
    assert default_invoice_cycle(instance, txs, date(2026, 10, 10)) == "2026-10-29"
