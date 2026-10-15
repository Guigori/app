"""Prevent accidental return to the old MongoDB ASGI entrypoint.

The historical source may stay in Git for audit, but it must not be part of
the running financial API or production dependencies.
"""
from importlib import util
from pathlib import Path
import json

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[3]


def test_deprecated_backend_server_is_the_canonical_firebase_app(monkeypatch):
    monkeypatch.delenv("MONGO_URL", raising=False)
    monkeypatch.delenv("DB_NAME", raising=False)
    old_entrypoint = ROOT / "backend/server.py"
    spec = util.spec_from_file_location("finnos_retired_backend_compat", old_entrypoint)
    module = util.module_from_spec(spec)
    spec.loader.exec_module(module)
    from api.index import app as firebase_app
    assert isinstance(module.app, FastAPI)
    assert module.app is firebase_app
    assert any(getattr(route, "path", None) == "/api/auth/me" for route in module.app.routes)
    # Finance routes are mounted through FastAPI's included-router container.
    # A 401 (rather than 404) proves the endpoint exists without credentials.
    from fastapi.testclient import TestClient
    with TestClient(module.app) as client:
        assert client.get("/api/finance/integrity").status_code == 401


def test_active_runtime_never_imports_motor_or_mongo():
    active = [
        ROOT / "frontend/api/index.py",
        ROOT / "frontend/finnos/routes.py",
        ROOT / "frontend/finnos/lib/db.py",
        ROOT / "backend/server.py",
    ]
    forbidden = (
        "motor.motor_asyncio", "pymongo", "from lib.db import",
        "AsyncIOMotorClient", "MONGO_URL",
    )
    for path in active:
        content = path.read_text(encoding="utf-8")
        # Ignore explanatory comments while checking actual Python statements.
        instructions = [
            line.strip() for line in content.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        for statement in instructions:
            assert not statement.startswith((
                "from motor", "import motor", "import pymongo", "from pymongo",
                "from lib.db", "mongo_url =", "client = AsyncIOMotorClient"
            )), (path, statement)
    requirements = (ROOT / "backend/requirements.txt").read_text(encoding="utf-8")
    assert not any(line.strip().startswith(("motor==", "pymongo==", "motor>=", "pymongo>="))
                   for line in requirements.splitlines())


def test_production_routes_cover_every_subscription_method():
    config = json.loads((ROOT / "frontend/vercel.json").read_text(encoding="utf-8"))
    import re
    route = config["routes"][0]
    assert route["dest"] == "/api"
    for path in ("/api/subscriptions", "/api/subscriptions/sample-id",
                 "/api/finance/integrity", "/api/auth/me"):
        assert re.fullmatch(route["src"], path), path


def test_legacy_mongo_adapter_fails_closed_without_connecting(monkeypatch):
    """Old imports cannot accidentally reconnect and write to another database."""
    monkeypatch.delenv("MONGO_URL", raising=False)
    monkeypatch.delenv("DB_NAME", raising=False)
    import pytest
    spec = util.spec_from_file_location("finnos_retired_mongo_adapter", ROOT / "backend/lib/db.py")
    module = util.module_from_spec(spec)
    with pytest.raises(RuntimeError, match="MongoDB legado foi desativado"):
        spec.loader.exec_module(module)
