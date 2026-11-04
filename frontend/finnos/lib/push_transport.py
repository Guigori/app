"""Optional, opt-in VAPID Web Push transport.

The default is DISABLED. A deployment is not allowed to advertise Web Push
unless all required configuration is present. Subscription endpoints must be
from a known push gateway to prevent an authenticated account from making
the server POST to an arbitrary internal/private URL.
"""
import hashlib
import hmac
import json
import os
from urllib.parse import urlsplit

from fastapi import HTTPException

ALLOWED_GATEWAYS = frozenset({
    "fcm.googleapis.com",
    "android.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "web.push.apple.com",
    "push.apple.com",
    "wns2-blu.notify.windows.com",
    "notify.windows.com",
})


def ready() -> bool:
    return (
        os.environ.get("FINNOS_PUSH_ENABLED") == "1"
        and bool(os.environ.get("VAPID_PUBLIC_KEY"))
        and bool(os.environ.get("VAPID_PRIVATE_KEY"))
        and bool(os.environ.get("VAPID_SUBJECT"))
    )


def gateway(endpoint: str) -> str:
    try:
        parsed = urlsplit(endpoint)
        host = parsed.hostname or ""
        if (
            parsed.scheme != "https"
            or host not in ALLOWED_GATEWAYS
            or parsed.port not in (None, 443)
            or parsed.username is not None
            or parsed.password is not None
            or len(endpoint) > 600
            or parsed.fragment
        ):
            raise ValueError("gateway")
        return host
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, "Endpoint de Push não permitido.") from exc


def registration_id(uid: str, endpoint: str) -> str:
    return hashlib.sha256((uid + "\0" + endpoint).encode()).hexdigest()


def require_cron_secret(authorization: str | None) -> None:
    secret = os.environ.get("CRON_SECRET") or ""
    if len(secret) < 16 or not authorization or not hmac.compare_digest(
        authorization, "Bearer " + secret
    ):
        raise HTTPException(401, "Agendamento não autorizado.")


def send(subscription: dict, notification: dict) -> None:
    if not ready():
        raise HTTPException(503, "Push remoto não configurado.")
    gateway(subscription["endpoint"])
    from pywebpush import webpush

    payload = {
        "title": str(notification.get("title") or "FINNOS")[:100],
        "body": str(notification.get("body") or "")[:250],
        "url": str(notification.get("url") or "/notificacoes")[:300],
    }
    # Do not include sensitive account amounts in unencrypted logs, requests
    # to third-party analytics or dispatch metadata. WebPush encrypts payload.
    webpush(
        subscription_info=subscription,
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
        vapid_claims={"sub": os.environ["VAPID_SUBJECT"]},
        ttl=3600,
        timeout=10,
    )
