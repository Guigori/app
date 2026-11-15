"""Daily copy of every FINNOS user's data into MongoDB (camada 7). Runs in GitHub Actions only.

- Reads from the FINNOS API (POST /api/finance/backups-export, Bearer FINNOS_CRON_SECRET), page by page.
- Writes ONLY to the database named by BACKUP_DB_NAME (default "finnos_backup"), never to the historical one:
  the script refuses a database that has collections and no FINNOS backup marker, and refuses the name in DB_NAME.
- Each copy is the same checksummed backup a person downloads, gzip-compressed; the checksum is verified before
  it is stored. Unchanged users (same finance revision as the newest copy) are not exported again.
- Keeps the newest KEEP copies per user. Prints counts only, never data.
"""
import base64
import gzip
import hashlib
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

MARKER = "_finnos_backup"
KEEP = int(os.getenv("BACKUP_KEEP", "30"))
API = os.getenv("FINNOS_API", "https://finnos.vercel.app/api")


def checksum(collections: dict) -> str:
    canonical = json.dumps(collections, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def target_database(client, name: str, historical: str | None):
    if not name or name == historical:
        sys.exit(f"Banco de backup inválido ({name!r}): não pode ser o banco histórico.")
    database = client[name]
    existing = set(database.list_collection_names())
    if existing and MARKER not in existing:
        sys.exit(f"O banco {name!r} já tem coleções e não é um banco de backup do FINNOS; nada foi gravado.")
    if MARKER not in existing:
        database[MARKER].insert_one({"_id": "marker", "created_at": datetime.now(timezone.utc),
                                     "purpose": "Cópias diárias do FINNOS; não é o banco histórico."})
    return database


def fetch_page(secret: str, after, known: dict) -> dict:
    body = json.dumps({"after": after, "limit": 5, "known": known}).encode()
    request = urllib.request.Request(f"{API}/finance/backups-export", data=body, method="POST", headers={
        "Authorization": f"Bearer {secret}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def main() -> None:
    url, secret = os.getenv("MONGO_URL"), os.getenv("FINNOS_CRON_SECRET")
    if not url or not secret:
        print("MONGO_URL ou FINNOS_CRON_SECRET não configurado; backup diário pulado.")
        return
    from pymongo import ASCENDING, DESCENDING, MongoClient

    client = MongoClient(url, serverSelectionTimeoutMS=20000)
    database = target_database(client, os.getenv("BACKUP_DB_NAME") or "finnos_backup", os.getenv("DB_NAME"))
    copies = database["snapshots"]
    copies.create_index([("uid", ASCENDING), ("created_at", DESCENDING)])

    known = {}
    for row in copies.aggregate([{"$sort": {"created_at": -1}},
                                 {"$group": {"_id": "$uid", "revision": {"$first": "$revision"}}}]):
        known[row["_id"]] = row["revision"]

    counts = {"saved": 0, "unchanged": 0, "failed": 0}
    after = None
    while True:
        page = fetch_page(secret, after, known)
        for item in page["items"]:
            if item.get("unchanged"):
                counts["unchanged"] += 1
                continue
            if "error" in item:
                counts["failed"] += 1
                continue
            raw = base64.b64decode(item["gzip_b64"])
            data = json.loads(gzip.decompress(raw))
            if data.get("checksum_sha256") != checksum(data.get("collections", {})) \
                    or data["checksum_sha256"] != item["checksum_sha256"]:
                counts["failed"] += 1
                continue
            now = datetime.now(timezone.utc)
            copies.insert_one({
                "_id": f"{item['uid']}:{now.strftime('%Y%m%dT%H%M%SZ')}", "uid": item["uid"],
                "revision": item["revision"], "created_at": now, "exported_at": item["exported_at"],
                "counts": item["counts"], "checksum_sha256": item["checksum_sha256"], "gzip": raw,
            })
            old = [d["_id"] for d in copies.find({"uid": item["uid"]}, {"_id": 1}).sort("created_at", -1).skip(KEEP)]
            if old:
                copies.delete_many({"_id": {"$in": old}, "uid": item["uid"]})
            counts["saved"] += 1
        after = page.get("next")
        if not after:
            break
    print(json.dumps(counts))
    if counts["failed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
