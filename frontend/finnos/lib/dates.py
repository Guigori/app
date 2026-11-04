from finnos.lib.money import D

"""Server-side date helpers for financial dates."""
import os
from datetime import datetime
from zoneinfo import ZoneInfo


def today_iso(tz: str | None = None) -> str:
    """Today's date as YYYY-MM-DD in `tz` (default: APP_TZ, else Sao Paulo)."""
    zone = tz or os.environ.get("APP_TZ", "America/Sao_Paulo")
    return datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d")
