"""Explicit cutover gate: no live API router/Firestore adapter uses v1 shadows.

Prevents a future refactor from silently making uncertified monthly aggregates
authoritative. Changing this guard is a distinct code-review decision and
requires live/emulator, UID and offline test evidence, not only unit CI.
"""
import ast
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]


def test_production_financial_routes_do_not_import_shadow_aggregates():
    app_paths = [
        *sorted((BASE / "routers").glob("*.py")),
        BASE / "lib" / "db.py",
        BASE / "routes.py",
    ]
    forbidden_prefixes = (
        "finnos.lib.monthly_aggregate_shadow",
        "finnos.lib.monthly_aggregate_shadow_reads",
        "finnos.lib.monthly_aggregate_mutations",
    )
    for path in app_paths:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith(forbidden_prefixes), (
                    "Shadow-only module imported by active API: " + str(path)
                )
            elif isinstance(node, ast.Import):
                for name in node.names:
                    assert not name.name.startswith(forbidden_prefixes), (
                        "Shadow-only module imported by active API: " + str(path)
                    )
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                assert "_finance_month_shadows_v1" not in node.value, (
                    "Active API refers to uncertified shadow storage: " + str(path)
                )
