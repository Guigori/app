from datetime import datetime, date
from zoneinfo import ZoneInfo

DEFAULT_TIMEZONE = "America/Sao_Paulo"

def financial_today(*, now: datetime | None = None, timezone_name: str = DEFAULT_TIMEZONE) -> date:
    tz = ZoneInfo(timezone_name)
    if now is None:
        now = datetime.now(tz)
    elif now.tzinfo is None:
        raise ValueError("FAC clock requires an aware datetime")
    return now.astimezone(tz).date()
