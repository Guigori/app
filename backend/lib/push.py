"""Web Push (VAPID). The private key stays here; only the public key ever leaves."""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from fastapi.concurrency import run_in_threadpool
from pywebpush import WebPushException, webpush

from lib.db import db

load_dotenv()
logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY_B64", "")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:avisos@finnos.app")


def push_configured() -> bool:
    return bool(VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY)


async def send_push_to_user(user_id: str, *, title: str, body: str, url: str = "/", tag: str = "finnos") -> int:
    """Deliver to every device the user registered. Dead endpoints are pruned."""
    if not push_configured():
        return 0
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    docs = await db.push_subscriptions.find({"user_id": user_id}).to_list(50)
    sent = 0
    for doc in docs:
        subscription = {"endpoint": doc["endpoint"], "keys": doc["keys"]}
        try:
            # pywebpush is synchronous — never block the event loop with it.
            await run_in_threadpool(
                webpush,
                subscription_info=subscription,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT},
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                await db.push_subscriptions.delete_one({"endpoint": doc["endpoint"]})
            else:
                logger.warning("push delivery failed: status=%s", status)
    return sent
