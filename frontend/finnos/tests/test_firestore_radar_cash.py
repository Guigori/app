"""Radar cash forecast must match the same ledger model as Home."""
from finnos.routers.radar import _settled_cash_balance


def test_cash_balance_respects_cards_transfers_and_invoice_payments():
    accounts = [{"id": "a", "initial_balance": 100}, {"id": "b", "initial_balance": 50}]
    txs = [
        {"id": "income", "account_id": "a", "type": "receita",
         "value": 100, "status": "pago", "date": "2026-10-01"},
        {"id": "transfer", "account_id": "a", "to_account_id": "b",
         "type": "transferencia", "value": 25, "status": "pago", "date": "2026-10-02"},
        {"id": "purchase", "account_id": "a", "card_id": "card",
         "type": "despesa", "value": 70, "status": "pago", "date": "2026-10-03"},
        {"id": "invoice", "account_id": "a", "card_id": None,
         "type": "despesa", "invoice_payment": True,
         "value": 70, "status": "pago", "date": "2026-10-10"},
        {"id": "future", "account_id": "a", "card_id": None,
         "type": "despesa", "value": 90, "status": "pendente", "date": "2026-10-20"},
    ]
    assert _settled_cash_balance(accounts, txs, "2026-10-14") == 180


def test_settled_future_date_uses_home_semantics():
    accounts = [{"id": "a", "initial_balance": 10}]
    txs = [{"id": "income", "account_id": "a", "type": "receita",
            "value": 15, "status": "pago", "date": "2026-10-20"}]
    assert _settled_cash_balance(accounts, txs, "2026-10-14") == 25
