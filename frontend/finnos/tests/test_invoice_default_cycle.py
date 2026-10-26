"""FIN-01 regression: an unpaid closed invoice must be the default."""
from datetime import date

from finnos.lib.invoices import default_invoice_cycle, invoice_state, output


def card():
    return {"id": "card", "name": "Cartão", "closing_day": 29, "due_day": 7, "invoice_cycles": {}}


def expense(day="2026-09-25", value=300):
    return {"id": "purchase", "name": "Compra", "type": "despesa", "card_id": "card",
            "date": day, "value": value, "status": "pago", "installment": False}


def test_closed_invoice_is_visible_instead_of_empty_open_cycle():
    instance = card()
    txs = [expense()]
    cycle = default_invoice_cycle(instance, txs, date(2026, 10, 10))
    assert cycle == "2026-09-29"
    result = output(invoice_state(instance, txs, cycle))
    assert result["outstanding"] == 300
    assert result["total"] == 300
    assert result["due_date"] == "2026-10-07"


def test_after_paying_closed_invoice_default_returns_current_cycle():
    instance = card()
    instance["invoice_cycles"]["2026-09-29"] = {
        "items": [{"id": "purchase", "name": "Compra", "date": "2026-09-25",
                   "purchase_cents": 30000, "category_name": None,
                   "category_color": None, "installment_label": None}],
        "paid_cents": 30000,
        "paid_at": "2026-10-07",
    }
    assert default_invoice_cycle(instance, [expense()], date(2026, 10, 10)) == "2026-10-29"


def test_oldest_unpaid_closed_cycle_wins():
    txs = [expense("2026-08-25", 100), {**expense("2026-09-25", 200), "id": "later"}]
    assert default_invoice_cycle(card(), txs, date(2026, 10, 10)) == "2026-08-29"


def test_invoice_explicit_cycle_is_unchanged():
    instance = card()
    result = invoice_state(instance, [expense()], "2026-10-29")
    assert result["total_cents"] == 0
