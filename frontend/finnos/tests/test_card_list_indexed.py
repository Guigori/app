"""Card list must keep invoice per card, never mix purchases or silently truncate."""
import asyncio
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from finnos.routers import cards


def card(identifier):
    return {
        "id": identifier, "name": identifier, "institution": "Banco",
        "closing_day": 29, "due_day": 7, "limit": Decimal("1000.00"),
        "payment_account_id": "bank",
    }


def purchase(identifier, card_id, value):
    return {
        "id": identifier, "name": identifier, "date": "2026-10-20",
        "status": "pago", "installment": False,
        "type": "despesa", "card_id": card_id,
        "value": Decimal(value), "account_id": "bank",
    }


def configure(monkeypatch):
    cards_data = [card("one"), card("two")]
    accounts_data = [{"id": "bank", "name": "Conta"}]
    transactions = {
        "one": [purchase("a", "one", "17.23")],
        "two": [purchase("b", "two", "44.10")],
    }
    events = []
    state = {"revision": 6}

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, *args):
            return self

        async def to_list(self, size):
            assert size in (200, 500)
            return self.rows

    class Collection:
        def __init__(self, key):
            self.key = key

        def find(self, query):
            assert query["user_id"] == "owner"
            events.append(("read", self.key))
            return Cursor(cards_data if self.key == "cards" else accounts_data)

    async def revision(uid):
        assert uid == "owner"
        return state["revision"]

    async def read_card(uid, card_id, expected_revision):
        assert (uid, expected_revision) == ("owner", 6)
        events.append(("card", card_id))
        return transactions[card_id]

    monkeypatch.setattr(cards, "db", SimpleNamespace(
        cards=Collection("cards"), accounts=Collection("accounts"),
    ))
    monkeypatch.setattr(cards, "today_iso", lambda: "2026-10-27")
    monkeypatch.setattr("finnos.lib.account_balances.finance_revision", revision)
    monkeypatch.setattr("finnos.lib.card_transaction_reads.read_card_purchases", read_card)
    return events, state


def test_list_returns_independent_invoice_totals_without_global_history(monkeypatch):
    events, _ = configure(monkeypatch)
    result = asyncio.run(cards.list_cards(user={"id": "owner"}))
    assert [x.id for x in result] == ["one", "two"]
    assert [x.current_invoice for x in result] == [
        Decimal("17.23"), Decimal("44.10"),
    ]
    assert [x.used for x in result] == [
        Decimal("17.23"), Decimal("44.10"),
    ]
    assert events == [
        ("read", "cards"), ("read", "accounts"),
        ("card", "one"), ("card", "two"),
    ]


def test_list_refuses_mixed_snapshot_when_history_changes(monkeypatch):
    events, state = configure(monkeypatch)
    call = 0
    async def revise(uid):
        nonlocal call
        call += 1
        return 6 if call < 4 else 7

    monkeypatch.setattr("finnos.lib.account_balances.finance_revision", revise)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(cards.list_cards(user={"id": "owner"}))
    assert exc.value.status_code == 409
