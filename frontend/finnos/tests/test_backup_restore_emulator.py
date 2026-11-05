"""Backup → restore round trip through the real ASGI app and the real Firestore Emulator.

User A's data is exported with GET /api/finance/backup and restored into an empty
user B with POST /api/finance/restore; B must end with the same accounts, balances,
cards and transactions, reusing B's own default category by name. Synthetic UIDs,
demo-finnos project only — never live data.
"""
import asyncio
import os
from unittest.mock import patch

import firebase_admin
import httpx
import pytest
from firebase_admin import firestore
from google.auth.credentials import AnonymousCredentials

from finnos.lib import db as store

pytestmark = pytest.mark.skipif(
    not (
        os.getenv("FINNOS_SHADOW_OUTBOX_MODE") == "emulator"
        and os.getenv("FIRESTORE_EMULATOR_HOST")
        and os.getenv("FIREBASE_PROJECT_ID") == "demo-finnos"
    ),
    reason="Restauração real somente no Firestore Emulator demo-finnos.",
)

SOURCE = "test-backup-source"
TARGET = "test-backup-target"


def require(response, expected):
    assert response.status_code == expected, f"{response.request.method} {response.request.url} → {response.status_code}: {response.text[:700]}"
    return response.json() if response.content else {}


def test_backup_restores_into_an_empty_account_with_identical_finances(monkeypatch):
    with patch("google.auth.default", return_value=(AnonymousCredentials(), "demo-finnos")):
        demo_app = firebase_admin.initialize_app(options={"projectId": "demo-finnos"}, name="backup-restore-emulator")
        instance = firestore.client(app=demo_app)
    monkeypatch.setattr(store, "client", lambda: instance)
    monkeypatch.setenv("VERCEL_ENV", "development")

    source = store.root(instance, SOURCE)
    source.collection("accounts").document("bank").set({"name": "Conta origem", "initial_balance_cents": 100000})
    source.collection("categories").document("src-market").set({"name": "Mercado", "color": "#22aa55", "icon": "shopping-cart"})
    source.collection("categories").document("src-pets").set({"name": "Pets", "color": "#aa5522", "icon": "paw-print"})
    # The target already has its own default "Mercado" (another ID): it must be reused, not duplicated.
    store.root(instance, TARGET).collection("categories").document("tgt-market").set({"name": "Mercado", "color": "#22aa55", "icon": "shopping-cart"})

    from api import index as api
    current = {"uid": SOURCE}
    monkeypatch.setattr(api, "verified_claims", lambda token, session=False: {"uid": current["uid"], "email": "test@example.invalid", "email_verified": True})

    async def scenario():
        transport = httpx.ASGITransport(app=api.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30) as client:
            def headers(uid, operation=None):
                h = {"Origin": "http://testserver", "Authorization": "Bearer synthetic-emulator-test", "X-Finnos-User-Id": uid}
                if operation:
                    h["X-Finnos-Operation-Id"] = operation
                return h

            current["uid"] = SOURCE
            store.active_uid.set(SOURCE)
            for i, (name, value, category) in enumerate([("Feira", 120.5, "src-market"), ("Ração", 89.9, "src-pets"), ("Mercado do mês", 410, "src-market")]):
                require(await client.post("/api/transactions", headers=headers(SOURCE, f"seed-{i}"), json={
                    "name": name, "value": value, "type": "despesa", "status": "pago", "date": f"2026-10-1{i}",
                    "account_id": "bank", "card_id": None, "category_id": category,
                }), 201)
            backup = require(await client.get("/api/finance/backup", headers=headers(SOURCE)), 200)
            assert backup["counts"]["transactions"] == 3 and backup["counts"]["accounts"] == 1
            source_accounts = require(await client.get("/api/accounts", headers=headers(SOURCE)), 200)

            current["uid"] = TARGET
            store.active_uid.set(TARGET)
            out = require(await client.post("/api/finance/restore", headers=headers(TARGET), json=backup), 200)
            assert out["reused_categories"] == 1
            assert out["restored"]["transactions"] == 3 and out["restored"]["categories"] == 1

            accounts = require(await client.get("/api/accounts", headers=headers(TARGET)), 200)
            assert [(a["name"], a["balance"]) for a in accounts] == [(a["name"], a["balance"]) for a in source_accounts]
            txs = require(await client.get("/api/transactions?start_date=2026-10-01&end_date=2026-10-31", headers=headers(TARGET)), 200)
            assert sorted((t["name"], t["value"]) for t in txs) == [("Feira", 120.5), ("Mercado do mês", 410), ("Ração", 89.9)]
            market = [t for t in txs if t["name"] != "Ração"]
            assert {t["category_id"] for t in market} == {"tgt-market"}
            categories = require(await client.get("/api/categories", headers=headers(TARGET)), 200)
            assert sorted(c["name"] for c in categories).count("Mercado") == 1

            # A second restore into the (now non-empty) account is refused and changes nothing.
            again = await client.post("/api/finance/restore", headers=headers(TARGET), json=backup)
            assert again.status_code == 409
            assert len(require(await client.get("/api/transactions?start_date=2026-10-01&end_date=2026-10-31", headers=headers(TARGET)), 200)) == 3

    try:
        asyncio.run(scenario())
    finally:
        firebase_admin.delete_app(demo_app)
