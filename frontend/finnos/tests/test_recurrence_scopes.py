"""FIN-03: scoped recurrence changes never mutate settled historic rows."""
from copy import deepcopy
from decimal import Decimal

import pytest

from finnos.lib.recurrence_scopes import plan_recurrence_edit
from finnos.lib.recurrence import monthly_projection_sources
from finnos.models.finnos import TransactionIn
from finnos.routers.transactions import _document


def source():
    return {
        "id": "original", "user_id": "owner", "name": "Internet",
        "value": Decimal("100.00"), "type": "despesa",
        "status": "pago", "date": "2026-09-10",
        "account_id": "bank", "category_id": "internet",
        "card_id": None, "fixed": True, "installment": False,
        "recurrence": "mensal", "recurrence_id": "series-1",
    }


def plan(scope, day="2026-11-10", **changes):
    return plan_recurrence_edit(
        source(), changes or {"value": Decimal("125.40")},
        scope=scope, effective_date=day,
        operation_id="offline-1", uid="owner", today="2026-10-28",
    )


def test_new_fixed_source_gets_durable_series_contract():
    payload = TransactionIn(
        name="Internet", value=100, type="despesa", status="agendado",
        date="2026-12-10", account_id="bank", fixed=True, recurrence="mensal",
    )
    # The router allocates deterministic series IDs at create; model output
    # declares the optional field so older records remain readable.
    doc = _document("owner", payload)
    assert doc["fixed"] is True
    assert doc["recurrence"] == "mensal"


def test_one_occurrence_overrides_only_that_month():
    old = source()
    edit = plan("esta")["after"]
    assert edit["recurrence_id"] == old["recurrence_id"]
    assert edit["fixed"] is False
    assert plan("esta")["after"]["id"] == edit["id"]
    assert monthly_projection_sources([old, edit], "2026-11") == []
    after = monthly_projection_sources([old, edit], "2026-12")
    assert len(after) == 1 and after[0][0]["value"] == 100


def test_following_months_edit_preserves_past_and_suppresses_duplicate():
    old = source()
    edit = plan("proximas")["after"]
    assert edit["fixed"] and edit["status"] == "agendado"
    previous = monthly_projection_sources([old, edit], "2026-10")
    assert len(previous) == 1 and previous[0][0]["value"] == 100
    assert monthly_projection_sources([old, edit], "2026-11") == []
    later = monthly_projection_sources([old, edit], "2026-12")
    assert len(later) == 1 and later[0][0]["value"] == Decimal("125.40")
    assert old["value"] == 100


def test_all_only_changes_nonsettled_future_root():
    draft = source()
    draft.update(date="2026-12-10", status="agendado")
    result = plan_recurrence_edit(
        draft, {"value": Decimal("140.00")}, scope="todas",
        effective_date="2026-12-10", operation_id="op", uid="owner",
        today="2026-10-28",
    )
    assert result["action"] == "replace"
    assert result["after"]["id"] == draft["id"]
    assert result["after"]["recurrence_id"] == draft["recurrence_id"]
    assert result["after"]["value"] == Decimal("140.00")
    assert draft["value"] == 100


@pytest.mark.parametrize("scope,day", [
    ("todas", "2026-11-10"),
    ("esta", "2026-09-10"),
    ("proximas", "2026-01-10"),
    ("arbitrary", "2026-11-10"),
])
def test_unsafe_edits_are_refused(scope, day):
    with pytest.raises(ValueError):
        plan(scope, day)


def test_legacy_cross_uid_and_invalid_fields_fail_closed():
    original = source()
    for changed, uid in [
        ({**original, "recurrence_id": None}, "owner"),
        (original, "other"),
    ]:
        with pytest.raises(ValueError):
            plan_recurrence_edit(
                changed, {"value": 10}, scope="proximas",
                effective_date="2026-11-10", operation_id="op",
                uid=uid, today="2026-10-28",
            )
    with pytest.raises(ValueError):
        plan("esta", invoice_payment=True)
