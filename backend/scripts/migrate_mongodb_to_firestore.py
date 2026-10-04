"""One-way, idempotent MongoDB -> Firestore migration utility.

Defaults to dry-run. It never deletes MongoDB data and intentionally excludes
sessions, password/verification hashes, and encrypted provider API keys.
Run from the backend environment after configuring MONGO_URL, DB_NAME,
GOOGLE_APPLICATION_CREDENTIALS, and FIREBASE_PROJECT_ID.
"""
from __future__ import annotations

import argparse
import logging
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
import firebase_admin
from firebase_admin import firestore

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

# Explicit allowlist: operational/session data and secrets are not copied.
COLLECTIONS = (
    "users",
    "accounts",
    "categories",
    "transactions",
    "cards",
    "budget_cycles",
    "subscriptions",
    "push_subscriptions",
    "notify_prefs",
    "reminder_log",
    "radar_states",
    "radar_feedback",
)
USER_PRIVATE_FIELDS = {
    "password_hash",
    "verification_code_hash",
    "verification_expires_at",
    "verification_attempts",
    "verification_sent_at",
    "reset_password_hash",
    "reset_password_expires_at",
}
BATCH_SIZE = 400
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("finnos-migrate")


def normalize(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {str(k): normalize(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, (list, tuple)):
        return [normalize(v) for v in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def doc_id(document: dict[str, Any]) -> str:
    # Preserve stable application IDs wherever present.
    value = document.get("id") or document.get("user_id") or document.get("_id")
    if value is None:
        raise ValueError("Documento sem id estável; interrompendo para evitar perda.")
    return str(value)


def safe_document(collection: str, source: dict[str, Any]) -> dict[str, Any]:
    result = normalize(source)
    result.pop("_id", None)
    if collection == "users":
        for field in USER_PRIVATE_FIELDS:
            result.pop(field, None)
        # Firebase Authentication is migrated separately; never copy legacy password material.
        result["legacy_auth_migration_required"] = True
    result["migration"] = {
        "source": "mongodb",
        "migrated_at": datetime.now().astimezone().isoformat(),
    }
    return result


async def main() -> None:
    parser = argparse.ArgumentParser(description="Migra documentos FINNOS para Firestore.")
    parser.add_argument("--execute", action="store_true", help="Grava no Firestore. Sem isso, só faz auditoria.")
    parser.add_argument("--collections", nargs="*", choices=COLLECTIONS, default=list(COLLECTIONS))
    parser.add_argument("--project-id", default=os.getenv("FIREBASE_PROJECT_ID"))
    args = parser.parse_args()

    mongo_url = os.getenv("MONGO_URL")
    db_name = os.getenv("DB_NAME")
    if not mongo_url or not db_name:
        raise SystemExit("Configure MONGO_URL e DB_NAME no ambiente backend.")
    if args.execute and not args.project_id:
        raise SystemExit("Configure FIREBASE_PROJECT_ID antes de executar a migração.")

    client = AsyncIOMotorClient(mongo_url)
    source_db = client[db_name]
    target = None
    if args.execute:
        if not firebase_admin._apps:
            firebase_admin.initialize_app(options={"projectId": args.project_id})
        target = firestore.client()

    try:
        totals: dict[str, int] = {}
        for name in args.collections:
            collection = source_db[name]
            count = await collection.count_documents({})
            totals[name] = count
            logger.info("%s: %s documentos na origem", name, count)
            if not args.execute:
                continue

            assert target is not None
            batch = target.batch()
            pending = 0
            copied = 0
            async for source in collection.find({}):
                identifier = doc_id(source)
                payload = safe_document(name, source)
                ref = target.collection(name).document(identifier)
                batch.set(ref, payload, merge=True)
                pending += 1
                if pending >= BATCH_SIZE:
                    batch.commit()
                    copied += pending
                    batch = target.batch()
                    pending = 0
            if pending:
                batch.commit()
                copied += pending
            logger.info("%s: %s documentos gravados no Firestore", name, copied)

        if args.execute:
            logger.info("Migração concluída. MongoDB foi preservado; valide contagens e amostras antes do cutover.")
        else:
            logger.info("Dry-run concluído: nenhum dado foi alterado.")
        logger.info("Totais da origem: %s", totals)
    finally:
        client.close()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
