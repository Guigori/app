"""Error monitoring (Sentry), off unless SENTRY_DSN is set.

Never sends financial data: no request bodies, cookies, auth headers, query
strings, local variables or user identifiers. Only the error, its stack frames
(file/function/line) and the route.
"""
import os

KEEP_HEADERS = {"user-agent", "content-type"}


def scrub(event: dict, hint: dict | None = None) -> dict:
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        request.pop("query_string", None)
        request.pop("env", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {k: v for k, v in headers.items() if k.lower() in KEEP_HEADERS}
        if isinstance(request.get("url"), str):
            request["url"] = request["url"].split("?", 1)[0]
    event.pop("user", None)
    event.pop("extra", None)
    for exception in (event.get("exception") or {}).get("values", []) or []:
        for frame in (exception.get("stacktrace") or {}).get("frames", []) or []:
            frame.pop("vars", None)
    for crumb in (event.get("breadcrumbs") or {}).get("values", []) or []:
        crumb.pop("data", None)
    return event


def init_sentry() -> bool:
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("VERCEL_ENV", "development"),
        release=os.getenv("VERCEL_GIT_COMMIT_SHA") or None,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        traces_sample_rate=0,
        before_send=scrub,
        before_send_transaction=lambda event, hint: None,
    )
    return True
