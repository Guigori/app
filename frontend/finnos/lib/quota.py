"""Firestore's daily free quota (Spark plan) running out.

When it does, every read fails with RESOURCE_EXHAUSTED until the quota resets at midnight Pacific time
(05:00 in Brasília, 04:00 during US daylight time). Instead of an opaque 500 that the app retries again and again,
the API answers 503 with code "quota_exhausted" and the time it reopens, so the app can say so, stop asking until
then and show the last data this device already has.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import Request
from fastapi.responses import JSONResponse

PACIFIC = ZoneInfo("America/Los_Angeles")
CODE = "quota_exhausted"


def reopens_at(now: datetime | None = None) -> datetime:
    """Next midnight in Pacific time, as an aware UTC datetime."""
    now = (now or datetime.now(tz=PACIFIC)).astimezone(PACIFIC)
    midnight = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=PACIFIC)
    return midnight.astimezone(ZoneInfo("UTC"))


def is_quota_exhausted(error: BaseException | None) -> bool:
    seen = 0
    while error is not None and seen < 8:
        name = type(error).__name__
        if name == "ResourceExhausted" or "RESOURCE_EXHAUSTED" in str(getattr(error, "code", "")):
            return True
        error = error.__cause__ or error.__context__
        seen += 1
    return False


def response(now: datetime | None = None) -> JSONResponse:
    until = reopens_at(now)
    seconds = max(60, int((until - (now or datetime.now(tz=PACIFIC))).total_seconds()))
    return JSONResponse(
        {"detail": "O limite diário do banco de dados foi atingido. Os dados voltam a carregar sozinhos.",
         "code": CODE, "retry_at": until.isoformat().replace("+00:00", "Z")},
        status_code=503, headers={"Retry-After": str(seconds), "Cache-Control": "private, no-store"})


def install(app) -> None:
    from google.api_core.exceptions import ResourceExhausted

    async def handle(request: Request, exc: Exception):
        return response()

    app.add_exception_handler(ResourceExhausted, handle)

    @app.middleware("http")
    async def wrapped_quota_errors(request: Request, call_next):
        # Some paths wrap the Firestore error (a streaming iterator, a retry); the chain still says what it is.
        try:
            return await call_next(request)
        except Exception as exc:
            if is_quota_exhausted(exc):
                return response()
            raise
