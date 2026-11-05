"""Monitoring never carries financial data, and is off without SENTRY_DSN."""
from finnos.lib import monitoring


def test_scrub_removes_everything_sensitive():
    event = {
        "request": {"url": "https://finnos.vercel.app/api/transactions?month=2026-11", "data": {"value": 1234.5}, "cookies": "s=1", "query_string": "month=2026-11",
                    "headers": {"Authorization": "Bearer x", "User-Agent": "UA", "X-Finnos-User-Id": "uid"}},
        "user": {"id": "uid", "email": "a@b.c"},
        "extra": {"balance": 9999},
        "exception": {"values": [{"stacktrace": {"frames": [{"function": "f", "lineno": 3, "vars": {"saldo": 9999}}]}}]},
        "breadcrumbs": {"values": [{"category": "http", "data": {"url": "/api/accounts", "body": "{...}"}}]},
    }
    out = monitoring.scrub(event)
    assert out["request"] == {"url": "https://finnos.vercel.app/api/transactions", "headers": {"User-Agent": "UA"}}
    assert "user" not in out and "extra" not in out
    assert out["exception"]["values"][0]["stacktrace"]["frames"][0] == {"function": "f", "lineno": 3}
    assert out["breadcrumbs"]["values"][0] == {"category": "http"}


def test_off_without_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert monitoring.init_sentry() is False
