"""Filters pushed to Firestore select a superset of what the Python filter keeps, so results never change."""
from finnos.lib.db import _pushdown


def test_date_range_goes_to_firestore():
    q = {"user_id": "u", "date": {"$gte": "2026-11-01", "$lte": "2026-11-30"}}
    assert sorted(_pushdown(q)) == [("date", "<=", "2026-11-30"), ("date", ">=", "2026-11-01")]


def test_range_wins_over_equalities_without_composite_index():
    q = {"user_id": "u", "type": "despesa", "date": {"$gte": "2026-11-01"}}
    assert _pushdown(q) == [("date", ">=", "2026-11-01")]


def test_string_equalities_and_one_in():
    q = {"user_id": "u", "card_id": "c1", "status": {"$in": ["agendado", "pendente"]}, "type": {"$in": ["despesa"]}}
    clauses = _pushdown(q)
    assert ("card_id", "==", "c1") in clauses
    assert sum(1 for c in clauses if c[1] == "in") == 1


def test_never_pushes_none_money_regex_or_or():
    q = {"user_id": "u", "card_id": None, "value": "10", "name": {"$regex": "x"}, "$or": [{"a": "b"}], "active": True}
    assert _pushdown(q) == []


def test_in_with_none_or_too_many_values_stays_in_python():
    assert _pushdown({"user_id": "u", "status": {"$in": ["pago", None]}}) == []
    assert _pushdown({"user_id": "u", "status": {"$in": [str(i) for i in range(31)]}}) == []
