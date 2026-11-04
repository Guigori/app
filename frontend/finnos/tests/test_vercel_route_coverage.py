"""Every FastAPI route mounted under /api must be forwarded by frontend/vercel.json.

A router that exists in FastAPI but is missing from the Vercel route regex answers
404 in production while every local test (TestClient) passes.
"""
import importlib
import json
import re
from pathlib import Path

VERCEL = Path(__file__).resolve().parents[2] / "vercel.json"
# Routes that are intentionally never published on Vercel.
NOT_PUBLISHED: set[str] = set()


def _paths(routes, prefix=""):
    for route in routes:
        if hasattr(route, "original_router"):  # FastAPI >= 0.140 keeps included routers nested
            context = getattr(route, "include_context", None)
            yield from _paths(route.original_router.routes, prefix + getattr(context, "prefix", ""))
        elif hasattr(route, "path"):
            yield prefix + route.path


def _api_source():
    config = json.loads(VERCEL.read_text())
    return next(r["src"] for r in config["routes"] if r.get("dest") == "/api")


def test_every_mounted_api_route_is_forwarded_by_vercel():
    app = importlib.import_module("api.index").app
    mounted = sorted({p for p in _paths(app.routes) if p.startswith("/api/")} - NOT_PUBLISHED)
    assert len(mounted) > 20, "route discovery failed; check the FastAPI router layout"
    source = _api_source()
    missing = [p for p in mounted if not re.fullmatch(source, re.sub(r"\{[^}]+\}", "sample-id", p))]
    assert missing == [], f"Vercel would answer 404 for: {missing}"


def test_vercel_never_forwards_unknown_api_prefixes():
    assert not re.fullmatch(_api_source(), "/api/not-a-finnos-route")
