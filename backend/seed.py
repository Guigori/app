"""Seeds the standalone demo account: demo@finnos.app / demo1234.

Idempotent — safe to re-run. Run: cd /app/backend && python seed.py
Not imported by server.py.
"""

import asyncio
import uuid
from datetime import datetime, timezone

from passlib.context import CryptContext

from lib.db import db, ensure_indexes
from lib.demo_data import load_demo_for_user

DEMO_EMAIL = "demo@finnos.app"
DEMO_PASSWORD = "demo1234"


async def main() -> None:
    await ensure_indexes()
    user = await db.users.find_one({"email": DEMO_EMAIL})
    if not user:
        pwd = CryptContext(schemes=["pbkdf2_sha256"])
        doc = {
            "id": str(uuid.uuid4()),
            "name": "Demo FINNOS",
            "email": DEMO_EMAIL,
            "password_hash": pwd.hash(DEMO_PASSWORD),
            "email_verified": True,  # demo account skips the e-mail code
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(doc)
        user = doc
        print("usuário demo criado")
    else:
        await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True}})
    await load_demo_for_user(user["id"])
    print(f"demo pronto → login: {DEMO_EMAIL} / {DEMO_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
