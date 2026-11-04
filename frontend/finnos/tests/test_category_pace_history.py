"""FINN-based category pace and audit trail regressions."""
from datetime import date

from finnos.lib.category_pace import monthly_pace
from finnos.lib.history import visible_summary, record_event


def expense(value, day, *, category="food", status="pago"):
    return {
        "id": str(day) + str(value),
        "type": "despesa", "status": status, "date": day,
        "name": "Mercado", "value": value,
        "category_id": category, "account_id": "bank", "installment": False,
    }


def test_spending_pace_spent_ideal_daily_allowance_and_forecast():
    txs = [
        expense(150, "2026-10-05"),
        expense(100, "2026-10-15"),
        expense(75, "2026-10-29"),  # future 'pago' legacy record is not realised
        expense(20, "2026-10-12", status="agendado"),
        expense(200, "2026-10-15", category="other"),
    ]
    result = monthly_pace(620, txs, "food", "2026-10", date(2026, 10, 20))
    assert result["spent_cents"] == 25000
    assert result["available_cents"] == 37000
    assert result["ideal_cents"] == 40000
    assert result["diff_from_ideal_cents"] == 15000
    assert result["daily_allowance_cents"] == 3363
    assert result["projected_month_end_cents"] == 38750
    assert result["cumulative_cents"][15] == 25000
    assert result["cumulative_cents"][4] == 0


def test_monthly_pace_future_and_february_are_safe():
    txs = [expense(90, "2026-01-31")]
    result = monthly_pace(200, txs, "food", "2026-02", date(2026, 1, 30))
    assert result["day"] == 0
    assert result["spent_cents"] == 0
    assert len(result["cumulative_cents"]) == 29
    assert result["daily_allowance_cents"] == 714


def test_no_limit_means_spent_is_visible_but_allowance_zero():
    result = monthly_pace(0, [expense(30, "2026-10-01")], "food", "2026-10", "2026-10-10")
    assert result["spent_cents"] == 3000
    assert result["daily_allowance_cents"] == 0
    assert result["available_cents"] == 0


def test_history_summary_redacts_sensitive_content():
    doc = {
        "id": "id-1", "name": "Mercado", "value": "12.34",
        "user_id": "private-uid", "notes": "secret", "password": "hidden",
        "card_id": "card", "date": "2026-10-26",
    }
    summary = visible_summary("transactions", doc)
    assert summary["value_cents"] == 1234
    assert summary["name"] == "Mercado"
    assert summary["date"] == "2026-10-26"
    assert "notes" not in summary and "password" not in summary
    assert "user_id" not in summary


def test_budget_change_summary_keeps_allocation_totals_and_counts_only():
    doc = {
        "id": "budget", "allocations": [
            {"category_id": "food", "planned": 150.55},
            {"category_id": "rent", "planned": 600},
        ], "expected_income": 2000,
    }
    summary = visible_summary("budget_cycles", doc)
    assert summary["allocated_cents"] == 75055
    assert summary["allocations_count"] == 2
    assert summary["expected_income_cents"] == 200000
    assert "allocations" not in summary


def test_append_only_audit_record_with_sanitized_before_and_after():
    writes = []

    class Collection:
        def document(self, id):
            return "finance_history:" + id

    class Parent:
        def collection(self, name):
            assert name == "finance_history"
            return Collection()

    class Transaction:
        def create(self, ref, value):
            writes.append((ref, value))

    before = {"id": "category-1", "name": "Compras", "monthly_budget": 100}
    after = {**before, "monthly_budget": 180}
    record_event(Transaction(), Parent(), "categories", "updated", before, after)
    assert len(writes) == 1
    _, event = writes[0]
    assert event["action"] == "updated"
    assert event["before"]["monthly_budget_cents"] == 10000
    assert event["after"]["monthly_budget_cents"] == 18000
    assert event["entity_id"] == "category-1"
    record_event(Transaction(), Parent(), "ai_keys", "created", None, {"id": "secret"})
    assert len(writes) == 1
