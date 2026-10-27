"""Real ASGI finance endpoints + real Firestore Emulator, synthetic UID only.

HTTP request validation, origin/identity middleware, canonical db.atomic,
invoice payment/credit/refund and offline retries use the actual app adapters.
No live credentials; emulator project must be demo-finnos.
"""
import asyncio
import os
from unittest.mock import patch

import firebase_admin
from firebase_admin import firestore
from fastapi import HTTPException
from google.auth.credentials import AnonymousCredentials
import httpx
import pytest

from finnos.lib import db as store
from finnos.lib.account_balances import finance_revision
from finnos.lib.monthly_aggregate_shadow_reads import (
    build_shadow_candidate, check_shadow_candidate,
)

pytestmark = pytest.mark.skipif(
    not (
        os.getenv("FINNOS_SHADOW_OUTBOX_MODE") == "emulator"
        and os.getenv("FIRESTORE_EMULATOR_HOST")
        and os.getenv("FIREBASE_PROJECT_ID") == "demo-finnos"
    ),
    reason="End-to-end financeiro somente no Firestore Emulator demo-finnos.",
)

UID = "test-shadow-endpoints"
HEADERS = {
    "Origin": "http://testserver",
    "Authorization": "Bearer synthetic-emulator-test",
    "X-Finnos-User-Id": UID,
}


def seed_firestore(instance):
    owner = store.root(instance, UID)
    owner.collection("accounts").document("bank").set({
        "name": "Conta de teste", "initial_balance_cents": 0,
    })
    owner.collection("categories").document("shopping").set({
        "name": "Compras", "color": "#aabbcc", "icon": "shopping-bag",
    })
    owner.collection("cards").document("card").set({
        "name": "Cartão de teste", "institution": "Banco Demo",
        "limit_cents": 100000, "closing_day": 29, "due_day": 7,
        "payment_account_id": "bank", "active": True,
    })
    return owner


def payload(name, value, *, date="2026-10-15", card_id="card"):
    return {
        "name": name, "value": value, "type": "despesa",
        "status": "pago", "date": date,
        "account_id": "bank", "card_id": card_id,
        "category_id": "shopping",
    }


def require_status(response, expected):
    assert response.status_code == expected, (
        response.request.method + " " + str(response.request.url)
        + " returned " + str(response.status_code) + ": " + response.text[:700]
    )
    return response.json() if response.content else {}


def test_emulator_real_finance_http_endpoints_and_offline_retries(monkeypatch):
    # Never initialize any Firebase Admin service-account app. The emulator
    # uses anonymous credentials and runs in a demo-only project.
    with patch("google.auth.default",
               return_value=(AnonymousCredentials(), "demo-finnos")):
        demo_app = firebase_admin.initialize_app(
            options={"projectId": "demo-finnos"}, name="shadow-finance-http",
        )
        instance = firestore.client(app=demo_app)
    owner = seed_firestore(instance)
    monkeypatch.setattr(store, "client", lambda: instance)
    monkeypatch.setenv("VERCEL_ENV", "development")

    from api import index as api
    from finnos.routers import transactions, cards

    monkeypatch.setattr(
        api, "verified_claims",
        lambda token, session=False: {
            "uid": UID, "email": "test@example.invalid", "email_verified": True,
        },
    )
    monkeypatch.setattr(cards, "today_iso", lambda: "2026-10-27")
    monkeypatch.setattr(transactions, "today_iso", lambda: "2026-10-27")

    async def scenario():
        transport = httpx.ASGITransport(app=api.app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver",
            headers=HEADERS, timeout=30,
        ) as client:
            async def post(url, data, operation):
                return await client.post(
                    url, json=data, headers={"X-Finnos-Operation-Id": operation},
                )

            create_data = payload("Compra importada", 200)
            first = require_status(
                await post("/api/transactions", create_data, "offline-purchase-1"), 201,
            )
            purchase_id = first["id"]
            assert first["value"] == 200
            repeated = require_status(
                await post("/api/transactions", create_data, "offline-purchase-1"), 201,
            )
            assert repeated["id"] == purchase_id

            update_data = payload("Compra importada", 220)
            update_headers = {
                "X-Finnos-Operation-Id": "offline-edit-1",
                "X-Finnos-Base-Version": "1",
            }
            edited = require_status(await client.put(
                f"/api/transactions/{purchase_id}",
                json=update_data, headers=update_headers,
            ), 200)
            assert edited["version"] == 2
            require_status(await client.put(
                f"/api/transactions/{purchase_id}",
                json=update_data, headers=update_headers,
            ), 200)

            credit_data = {
                "cycle": "2026-10-29", "purchase_id": purchase_id,
                "value": 20, "reason": "Devolução parcial",
            }
            credited = require_status(await post(
                "/api/cards/card/credits", credit_data, "merchant-credit-1",
            ), 200)
            assert credited["adjustment_total"] == 20
            require_status(await post(
                "/api/cards/card/credits", credit_data, "merchant-credit-1",
            ), 200)

            payment_data = {
                "cycle": "2026-10-29", "date": "2026-10-26",
                "account_id": "bank", "value": 200,
            }
            paid = require_status(await post(
                "/api/cards/card/pay", payment_data, "invoice-pay-1",
            ), 200)
            assert paid["paid"] is True
            require_status(await post(
                "/api/cards/card/pay", payment_data, "invoice-pay-1",
            ), 200)

            refund_data = {
                "cycle": "2026-10-29", "purchase_id": purchase_id,
                "date": "2026-10-27", "account_id": "bank",
                "value": 10, "reason": "Reembolso bancário parcial",
            }
            refunded = require_status(await post(
                "/api/cards/card/refunds", refund_data, "bank-refund-1",
            ), 200)
            assert refunded["refund_total"] == 10
            require_status(await post(
                "/api/cards/card/refunds", refund_data, "bank-refund-1",
            ), 200)

            temp = require_status(await post(
                "/api/transactions", payload(
                    "Teste sincronização", 12.34, date="2026-10-05", card_id=None,
                ), "offline-temporary-1",
            ), 201)
            delete_headers = {
                "X-Finnos-Operation-Id": "offline-delete-1",
                "X-Finnos-Base-Version": "1",
            }
            require_status(await client.delete(
                f"/api/transactions/{temp['id']}", headers=delete_headers,
            ), 204)
            require_status(await client.delete(
                f"/api/transactions/{temp['id']}", headers=delete_headers,
            ), 204)

            revision = await finance_revision(UID)
            # Seven writes and six idempotent retries, one revision each.
            assert revision == 13
            events = [
                owner.collection("_finance_shadow_outbox_v1")
                .document(f"{i:016d}").get().to_dict()
                for i in range(1, revision + 1)
            ]
            assert all(event is not None for event in events)
            assert all(event["finance_revision"] == ix
                       for ix, event in enumerate(events, 1))
            assert sum(item["is_noop"] for item in events) == 6
            assert sum(item["requires_rebuild"] for item in events) >= 3
            assert all(event["user_id"] == UID for event in events)
            assert len(list(owner.collection("transactions").stream())) == 3

            cards_data = [
                dict(store.decode(s.to_dict()), id=s.id, user_id=UID)
                for s in owner.collection("cards").stream()
            ]
            candidate = await build_shadow_candidate(UID, cards_data, revision)
            report = await check_shadow_candidate(
                UID, cards_data, revision, candidate,
            )
            assert report["match"], report
            assert candidate["source_count"] == 3
            assert candidate["months"]["2026-10"]["income_cents"] == 0
            assert candidate["months"]["2026-10"]["expense_cents"] == 19000
            assert not list(
                owner.collection("_finance_month_shadows_v1").limit(1).stream()
            )
    try:
        asyncio.run(scenario())
    finally:
        firebase_admin.delete_app(demo_app)
