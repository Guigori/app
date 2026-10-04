"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "users": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("email", ASCENDING)], name="email", unique=True),
    ],
    "sessions": [
        IndexModel([("token", ASCENDING)], name="token", unique=True),
        IndexModel([("user_id", ASCENDING)], name="user_id"),
        IndexModel([("expires_at", ASCENDING)], name="expires_at"),
    ],
    "accounts": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("user_id", ASCENDING), ("created_at", ASCENDING)], name="user_created"),
    ],
    "categories": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("user_id", ASCENDING), ("created_at", ASCENDING)], name="user_created"),
    ],
    "transactions": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("user_id", ASCENDING), ("date", DESCENDING)], name="user_date"),
        IndexModel([("user_id", ASCENDING), ("account_id", ASCENDING)], name="user_account"),
        IndexModel([("user_id", ASCENDING), ("category_id", ASCENDING)], name="user_category"),
        IndexModel([("user_id", ASCENDING), ("card_id", ASCENDING)], name="user_card"),
    ],
    "push_subscriptions": [
        IndexModel([("endpoint", ASCENDING)], name="endpoint", unique=True),
        IndexModel([("user_id", ASCENDING)], name="user"),
    ],
    "notify_prefs": [IndexModel([("user_id", ASCENDING)], name="user", unique=True)],
    "reminder_log": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
    "cards": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("user_id", ASCENDING), ("created_at", ASCENDING)], name="user_created"),
    ],
    "ai_keys": [
        IndexModel([("user_id", ASCENDING), ("provider", ASCENDING)], name="user_provider", unique=True),
    ],
    "radar_states": [
        IndexModel([("user_id", ASCENDING), ("signal_id", ASCENDING)], name="user_signal", unique=True),
        IndexModel([("user_id", ASCENDING), ("updated_at", DESCENDING)], name="user_updated"),
    ],
    "radar_feedback": [
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created"),
        IndexModel([("signal_id", ASCENDING)], name="signal"),
    ],
    "budget_cycles": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("user_id", ASCENDING), ("start_date", DESCENDING)], name="user_start"),
        IndexModel([("user_id", ASCENDING), ("end_date", DESCENDING)], name="user_end"),
    ],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
