"""FIN-08: signed refunds never become invalid negative donut segments."""
from decimal import Decimal

from finnos.lib.competency import monthly_competency, positive_category_slices


def test_positive_spend_category_can_be_plotted_with_refund_only_category():
    rows = {"rent": Decimal("200.00"), "returned": Decimal("-100.00")}
    weights = positive_category_slices(rows)
    assert weights == [("rent", Decimal("200.00"), Decimal("100.0"))]
    # Real financial net expense is R$100, but positive category wedges
    # must sum to 100% without a negative slice or 200% of net expense.
    assert sum(value for value in rows.values()) == 100


def test_month_with_only_bank_refund_preserves_negative_expense_but_has_empty_pie():
    txs = [{
        "id": "purchase", "type": "despesa", "status": "pago",
        "date": "2026-09-20", "value": 100, "card_id": "card",
        "category_id": "food", "installment": False,
    }]
    card = {
        "id": "card",
        "invoice_refunds": {"2026-09-29": [{
            "id": "r1", "purchase_id": "purchase",
            "date": "2026-10-26", "refund_cents": 10000,
        }]},
    }
    result = monthly_competency(txs, [card], "2026-10")
    assert result["income"] == 0
    assert result["expense"] == -100
    assert result["by_category"]["food"] == -100
    assert positive_category_slices(result["by_category"]) == []


def test_mixed_positive_categories_have_valid_percentages():
    wedges = positive_category_slices({
        "market": Decimal("60"), "transport": Decimal("40"),
        "refunds": Decimal("-15"),
    })
    assert [value[2] for value in wedges] == [Decimal("60.0"), Decimal("40.0")]
    assert sum(item[2] for item in wedges) == 100
