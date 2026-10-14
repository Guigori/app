"""Regression checks for the initial FIINT compatibility facade."""
from datetime import date

from lib.fiint.analysis import category_change_analyses
from lib.fac.analysis import category_change_analyses as legacy_analyze


def test_fiint_matches_fac_for_empty_history():
    today = date(2026, 10, 14)
    assert category_change_analyses([], [], as_of=today) == legacy_analyze(
        [], [], as_of=today
    )


def test_fiint_matches_fac_for_insufficient_history():
    today = date(2026, 10, 14)
    txs = [{
        "id": "t1", "type": "despesa", "status": "pago",
        "transaction_role": "purchase", "category_id": "food",
        "date": "2026-10-10", "value": 20,
    }]
    cats = [{"id": "food", "name": "Alimentação"}]
    assert category_change_analyses(txs, cats, as_of=today) == legacy_analyze(
        txs, cats, as_of=today
    )
