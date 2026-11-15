"""Answers kept until the person's data changes.

Screens like the month summary, the calendar, the accounts or the Radar read every lançamento to compute their
answer. The answer only changes when the person's data changes (the finance revision goes up on every write) or
when the day turns (due dates, "today" in projections). So the first request after a change computes and saves the
answer in `users/{uid}/_cache/{key}`; every later request with the same revision and day reads 2 small documents
(the revision and the saved answer) instead of the whole history. The saved answer is the same model the route
returns, so nothing the person sees changes.

The cache never decides a number: it stores what the normal code computed, and any doubt (another revision,
another day, an older format, an unreadable document, a write that fails) falls back to computing as before.
"""
import hashlib
import json
import logging
import os
from functools import wraps
from typing import Any

from pydantic import TypeAdapter

logger = logging.getLogger(__name__)

SCHEMA = 1
MAX_BYTES = 900_000  # a Firestore document holds 1 MiB


def _enabled() -> bool:
    return os.getenv("FINNOS_RESPONSE_CACHE", "1") != "0"


def _key(name: str, params: dict) -> str:
    raw = name + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
    return hashlib.sha256(raw.encode()).hexdigest()[:40]


def revision_cached(name: str, response_type: Any):
    """Decorates an async route `fn(..., user=...)` whose answer depends only on the person's data, the day and
    its other arguments."""
    adapter = TypeAdapter(response_type)

    def decorate(fn):
        @wraps(fn)
        async def wrapper(*args, **kwargs):
            user = kwargs.get("user")
            if args or not isinstance(user, dict) or not _enabled():
                return await fn(*args, **kwargs)
            uid = user.get("id")
            params = {k: v for k, v in kwargs.items() if k != "user"}
            try:
                from finnos.lib import db as store
                from finnos.lib.account_balances import finance_revision
                from finnos.lib.dates import today_iso
                from starlette.concurrency import run_in_threadpool
                revision = await finance_revision(uid)
                day = today_iso()
                ref = store.root(store.client(), uid).collection("_cache").document(_key(name, params))
                snap = await run_in_threadpool(ref.get)
                saved = snap.to_dict() if snap.exists else None
                if saved and saved.get("v") == SCHEMA and saved.get("r") == revision and saved.get("d") == day and saved.get("n") == name:
                    return adapter.validate_python(json.loads(saved["body"]))
            except Exception:  # no cache at hand: compute as always
                logger.debug("response cache unavailable for %s", name, exc_info=True)
                return await fn(*args, **kwargs)
            result = await fn(*args, **kwargs)
            try:
                # A route may return a plain dict; FastAPI would validate it against the same model.
                body = adapter.dump_json(adapter.validate_python(result)).decode()
                if len(body) <= MAX_BYTES:
                    await run_in_threadpool(lambda: ref.set({"v": SCHEMA, "n": name, "r": revision, "d": day, "body": body}))
            except Exception:
                logger.warning("response cache not saved for %s", name, exc_info=True)
            return result
        return wrapper
    return decorate
