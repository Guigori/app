"""No live credentials, endpoints or production writes: scheduled WebPush contract tests."""
from pathlib import Path

import pytest
from fastapi import HTTPException

from finnos.lib.push_transport import gateway, ready, require_cron_secret
from finnos.routers.push import _dispatch_window, _dispatch_kind_allowed


def test_push_stays_disabled_until_all_required_configuration_exists(monkeypatch):
    for key in ("FINNOS_PUSH_ENABLED", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"):
        monkeypatch.delenv(key, raising=False)
    assert ready() is False
    monkeypatch.setenv("FINNOS_PUSH_ENABLED", "1")
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "public")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "private")
    assert ready() is False
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:alerts@example.com")
    assert ready() is True


def test_scheduled_push_honors_selected_hour_and_lead_time():
    prefs = {"push_enabled": True, "hour": 9, "days_before": 3}
    assert _dispatch_window(prefs, 8) is None
    assert _dispatch_window(prefs, 9) == 3
    assert _dispatch_window({**prefs, "days_before": 0}, 9) == 0
    assert _dispatch_window({**prefs, "push_enabled": False}, 9) is None
    assert _dispatch_window({}, 9) == 1


def test_push_preferences_are_respected_per_notification_kind():
    prefs = {"invoice_reminders": False, "transaction_reminders": True}
    assert not _dispatch_kind_allowed("fatura", prefs)
    assert _dispatch_kind_allowed("vencimento", prefs)
    assert _dispatch_kind_allowed("atrasado", prefs)
    assert not _dispatch_kind_allowed("atrasado", {"transaction_reminders": False})


@pytest.mark.parametrize("endpoint", [
    "http://fcm.googleapis.com/send/x",
    "https://127.0.0.1/admin",
    "https://fcm.googleapis.com.evil.example/send",
    "https://user:password@fcm.googleapis.com/send/x",
    "https://fcm.googleapis.com:444/send/x",
    "https://fcm.googleapis.com/send#fragment",
])
def test_push_gateway_rejects_non_allowlisted_destinations(endpoint):
    with pytest.raises(HTTPException) as exc:
        gateway(endpoint)
    assert exc.value.status_code == 422


def test_valid_push_gateway_is_accepted():
    assert gateway("https://fcm.googleapis.com/fcm/send/abc") == "fcm.googleapis.com"


def test_scheduler_requires_exact_bearer_secret(monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "test-secret-long-enough")
    require_cron_secret("Bearer test-secret-long-enough")
    for header in (None, "test-secret-long-enough", "Bearer wrong-secret"):
        with pytest.raises(HTTPException) as exc:
            require_cron_secret(header)
        assert exc.value.status_code == 401


def test_hourly_workflow_uses_active_firebase_dispatch_contract():
    workflow = (Path(__file__).resolve().parents[3] / ".github/workflows/quality.yml").read_text()
    assert "--request GET" in workflow
    assert 'Authorization: Bearer $FINNOS_CRON_SECRET' in workflow
    assert "X-Cron-Secret" not in workflow
    assert "FINNOS_CRON_SECRET is not configured; dispatcher skipped." in workflow
