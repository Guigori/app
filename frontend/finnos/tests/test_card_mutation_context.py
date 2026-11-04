"""ARQ-02: card create/update summaries must not scan unrelated bank history."""
import asyncio
from decimal import Decimal
from types import SimpleNamespace

from finnos.routers import cards


def test_context_one_card_only_requests_that_cards_index(monkeypatch):
    accounts = [{"id": "bank", "name": "Banco"},
                {"id": "wallet", "name": "Carteira"}]
    events = []

    class Query:
        async def to_list(self, maximum):
            assert maximum == 500
            return accounts

    class Collection:
        def find(self, query):
            assert query["user_id"] == "uid"
            events.append(("accounts", "uid"))
            return Query()

    async def revision(uid):
        events.append(("revision", uid))
        return 21

    async def purchase_rows(uid, card_id, expected):
        events.append(("purchases", uid, card_id, expected))
        return [{
            "id": "buy", "card_id": card_id, "type": "despesa",
            "value": Decimal("25.31"),
        }]

    monkeypatch.setattr(cards, "db", SimpleNamespace(accounts=Collection()))
    monkeypatch.setattr("finnos.lib.account_balances.finance_revision", revision)
    monkeypatch.setattr("finnos.lib.card_transaction_reads.read_card_purchases",
                        purchase_rows)
    rows, accounts_by_id = asyncio.run(cards._context_one_card("uid", "card"))
    assert [row["id"] for row in rows] == ["buy"]
    assert accounts_by_id["wallet"]["name"] == "Carteira"
    assert events == [
        ("revision", "uid"), ("accounts", "uid"),
        ("purchases", "uid", "card", 21),
    ]
