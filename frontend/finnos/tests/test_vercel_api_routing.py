"""ARQ-01: prevent Preview/Production API endpoints from falling through to the SPA."""
import json
import re
from pathlib import Path


CONFIG = json.loads((Path(__file__).resolve().parents[2] / "vercel.json").read_text())
API_RULE = CONFIG["routes"][0]
SPA_RULE = CONFIG["routes"][-1]


def test_real_financial_endpoints_are_routed_to_serverless_api():
    assert API_RULE["dest"] == "/api"
    for path in (
        "/api/auth/me",
        "/api/accounts",
        "/api/institutions",
        "/api/onboarding",
        "/api/categories",
        "/api/transactions/transaction-id",
        "/api/cards/card-id/invoice",
        "/api/cards/card-id/credits",
        "/api/cards/card-id/refunds",
        "/api/finance/integrity",
        "/api/finance/history",
        "/api/analytics/flow",
        "/api/budgets/current",
        "/api/radar",
    ):
        assert re.fullmatch(API_RULE["src"], path), f"Missing API route: {path}"


def test_spa_fallback_cannot_consume_missing_api_endpoints():
    assert SPA_RULE["dest"] == "/index.html"
    assert not re.fullmatch(SPA_RULE["src"], "/api/finance/history")
    assert not re.fullmatch(SPA_RULE["src"], "/api/finance/missing")
    assert re.fullmatch(SPA_RULE["src"], "/historico")
