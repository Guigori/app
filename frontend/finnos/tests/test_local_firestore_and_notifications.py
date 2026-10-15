"""The active FINNOS dev API must not silently route finance to MongoDB."""
import json
from pathlib import Path


FRONTEND = Path(__file__).resolve().parents[2]


def test_local_proxy_uses_firestore_entrypoint_not_legacy_mongo_port():
    vite = (FRONTEND / "vite.config.ts").read_text(encoding="utf-8")
    package = json.loads((FRONTEND / "package.json").read_text(encoding="utf-8"))
    requirements = (FRONTEND / "requirements.txt").read_text(encoding="utf-8")
    assert '"http://127.0.0.1:8002"' in vite
    assert 'FINNOS_DEV_API_TARGET' in vite
    assert 'changeOrigin: false' in vite
    assert '"http://localhost:8001"' not in vite
    assert 'uvicorn api.index:app' in package["scripts"]["dev:api"]
    assert any(line.startswith('uvicorn==') for line in requirements.splitlines())


def test_notification_routes_registered_once():
    from finnos.routers import notifications
    from collections import Counter
    routes = Counter(
        (route.path, method)
        for route in notifications.router.routes
        for method in (route.methods or set())
    )
    assert routes[("/notifications/clear", "POST")] == 1
    assert routes[("/notifications/{notification_id}/dismiss", "POST")] == 1
    assert all(value == 1 for value in routes.values())
