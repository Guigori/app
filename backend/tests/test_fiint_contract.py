"""FIINT regression cases for preserved category-change behavior."""
from datetime import date, timedelta

from lib.fiint.analysis import category_change_analyses


def test_ignores_unpaid_and_transfers():
    today = date(2026, 10, 14)
    txs = [
        {"id": "pending", "type": "despesa", "status": "pendente",
         "category_id": "food", "date": today.isoformat(), "value": 500},
        {"id": "transfer", "type": "transferencia", "status": "pago",
         "category_id": "food", "date": today.isoformat(), "value": 500},
    ]
    assert category_change_analyses(
        txs, [{"id": "food", "name": "Alimentação"}], as_of=today
    ) == []


def test_stable_analysis_ids_for_same_input():
    today = date(2026, 10, 14)
    txs = []
    for days_ago in (80, 72, 64, 49, 40, 33):
        txs.append({
            "id": f"hist-{days_ago}", "type": "despesa",
            "status": "pago", "category_id": "food",
            "date": (today - timedelta(days=days_ago)).isoformat(),
            "value": 100,
        })
    txs.append({
        "id": "now", "type": "despesa", "status": "pago",
        "category_id": "food", "date": today.isoformat(), "value": 500,
    })
    categories = [{"id": "food", "name": "Alimentação"}]
    first = category_change_analyses(txs, categories, as_of=today)
    second = category_change_analyses(txs, categories, as_of=today)
    assert first == second
    assert all("analysis_id" in row for row in first)
