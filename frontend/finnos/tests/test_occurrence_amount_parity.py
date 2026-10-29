"""FIN-07/08 regression: missing legacy installment_value is not R$ 0,00."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

from finnos.lib.money import cents
from finnos.lib.transaction_amount import occurrence_amount
from finnos.routers import analytics


FIXTURE = json.loads(
    (Path(__file__).resolve().parents[2] / "fixtures" /
     "finance-occurrence-amount-parity.json").read_text(encoding="utf-8")
)


def test_occurrence_amount_shared_with_typescript_fixture():
    for row in FIXTURE["cases"]:
        assert cents(occurrence_amount(row["tx"])) == row["expected_cents"], row["id"]


def test_pending_legacy_installment_projects_in_flow_and_calendar(monkeypatch):
    tx = {
        "id": "legacy-pending", "name": "Parcela importada",
        "type": "despesa", "status": "pendente", "date": "2026-10-20",
        "value": 100, "installment": True, "total_installments": 3,
        "current_installment": 3, "account_id": "bank",
        "category_id": None, "card_id": None,
    }
    assert cents(analytics._projection(tx, "2026-10")) == 3334
    assert analytics._projection(tx, "2026-11") is None

    class Collection:
        def __init__(self, rows):
            self.rows = rows

        def find(self, query):
            assert query["user_id"] == "synthetic-uid"
            rows = self.rows
            if "date" in query:
                dates = query["date"]
                rows = [r for r in rows if dates["$gte"] <= r["date"] <= dates["$lte"]]
            return Cursor(rows)

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, limit):
            return self.rows[:limit]

    monkeypatch.setattr(analytics, "db", SimpleNamespace(
        transactions=Collection([tx]), cards=Collection([]),
        subscriptions=Collection([]),
    ))
    monkeypatch.setattr(analytics, "today_iso", lambda: "2026-10-26")
    async def revision(uid):
        assert uid == "synthetic-uid"
        return 1

    async def history(uid, months, cards, expected):
        assert (uid, months, expected) == ("synthetic-uid", ["2026-10"], 1)
        return [tx]

    monkeypatch.setattr(analytics, "finance_revision", revision)
    monkeypatch.setattr(analytics, "read_projection_history", history)
    calendar = asyncio.run(analytics.calendar_month(
        month="2026-10", user={"id": "synthetic-uid"},
    ))
    assert cents(calendar.projected_expense) == 3334
    assert cents(calendar.expense) == 0
    assert cents(calendar.days[0].projected_expense) == 3334
