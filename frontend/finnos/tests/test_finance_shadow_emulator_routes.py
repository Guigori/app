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
        # The ASGI middleware isolates request ContextVars from the calling
        # test task. Establish the same synthetic UID for post-request audit
        # reads, without weakening endpoint authentication.
        store.active_uid.set(UID)
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
            # Another operation with an old offline base version must fail
            # without advancing the canonical finance revision.
            stale = await client.put(
                f"/api/transactions/{purchase_id}",
                json=payload("Compra importada", 300),
                headers={
                    "X-Finnos-Operation-Id": "stale-offline-edit",
                    "X-Finnos-Base-Version": "1",
                },
            )
            assert stale.status_code == 409

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
            # A finalized purchase cannot be rewritten under a fresh offline
            # operation ID after settlement.
            changed_paid = await client.put(
                f"/api/transactions/{purchase_id}",
                json=payload("Compra alterada indevidamente", 250),
                headers={
                    "X-Finnos-Operation-Id": "edit-after-settlement",
                    "X-Finnos-Base-Version": "2",
                },
            )
            assert changed_paid.status_code == 409

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

            # Fail closed on a misconfigured opt-in, without writing a finance
            # document or advancing the canonical revision.
            monkeypatch.setenv("FIREBASE_PROJECT_ID", "finnos-app")
            rejected = await post(
                "/api/transactions",
                payload("Bloqueio", 4, date="2026-10-10", card_id=None),
                "wrong-project",
            )
            assert rejected.status_code == 503
            assert await finance_revision(UID) == revision
            monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-finnos")

            # Switch OFF: the normal canonical route continues to work, but
            # never creates a shadow envelope for the next finance revision.
            monkeypatch.delenv("FINNOS_SHADOW_OUTBOX_MODE")
            normal = require_status(await post(
                "/api/transactions",
                payload("Desligado", 5, date="2026-10-11", card_id=None),
                "disabled-outbox",
            ), 201)
            assert normal["value"] == 5
            assert await finance_revision(UID) == revision + 1
            assert not owner.collection("_finance_shadow_outbox_v1").document(
                f"{revision + 1:016d}"
            ).get().exists
    try:
        asyncio.run(scenario())
    finally:
        firebase_admin.delete_app(demo_app)


def test_entity_crud_offline_replays_are_atomic_and_versioned(monkeypatch):
    """All four entity kinds use the same real Firestore transaction contract."""
    uid = "test-shadow-entities"
    with patch("google.auth.default",
               return_value=(AnonymousCredentials(), "demo-finnos")):
        app = firebase_admin.initialize_app(
            options={"projectId": "demo-finnos"}, name="shadow-entities-http",
        )
        instance = firestore.client(app=app)
    owner = store.root(instance, uid)
    owner.collection("accounts").document("bank").set({
        "name": "Conta permanente", "initial_balance_cents": 0,
    })
    monkeypatch.setattr(store, "client", lambda: instance)
    monkeypatch.setenv("VERCEL_ENV", "development")
    from api import index as api
    monkeypatch.setattr(
        api, "verified_claims",
        lambda token, session=False: {
            "uid": uid, "email": "synthetic@example.invalid",
            "email_verified": True,
        },
    )
    cases = [
        ("/accounts", {
            "name": "Conta temporária", "institution": "", "type": "corrente",
            "color": "#070F52", "initial_balance": 0, "active": True,
        }),
        ("/categories", {
            "name": "Categoria temporária", "icon": "tag",
            "color": "#64748B", "group": "necessidades",
            "monthly_budget": 0, "monthly_goal": 0,
        }),
        ("/cards", {
            "name": "Cartão temporário", "institution": "", "color": "#5B3FE4",
            "limit": 1000, "closing_day": 29, "due_day": 7,
            "payment_account_id": None, "active": True,
        }),
        ("/subscriptions", {
            "name": "Assinatura temporária", "value": 19.90,
            "recurrence": "mensal", "next_charge": "2026-11-03",
            "account_id": "bank", "category_id": None, "card_id": None,
            "active": True, "notes": None,
        }),
    ]

    async def scenario():
        headers = {
            "Origin": "http://testserver", "X-Finnos-User-Id": uid,
            "Authorization": "Bearer isolated-identity",
        }
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=api.app),
            base_url="http://testserver", headers=headers, timeout=30,
        ) as client:
            for index, (path, payload) in enumerate(cases):
                original = require_status(await client.post(
                    "/api" + path, json=payload,
                    headers={"X-Finnos-Operation-Id": f"entity-create-{index}"},
                ), 201)
                assert original["version"] == 1
                entity_id = original["id"]
                again = require_status(await client.post(
                    "/api" + path, json=payload,
                    headers={"X-Finnos-Operation-Id": f"entity-create-{index}"},
                ), 201)
                assert again["id"] == entity_id
                updated = {**payload, "name": "Nome alterado"}
                edit_headers = {
                    "X-Finnos-Operation-Id": f"entity-edit-{index}",
                    "X-Finnos-Base-Version": "1",
                }
                edited = require_status(await client.put(
                    f"/api{path}/{entity_id}", json=updated,
                    headers=edit_headers,
                ), 200)
                assert edited["version"] == 2
                assert require_status(await client.put(
                    f"/api{path}/{entity_id}", json=updated,
                    headers=edit_headers,
                ), 200)["version"] == 2
                assert (await client.put(
                    f"/api{path}/{entity_id}", json=payload,
                    headers={
                        "X-Finnos-Operation-Id": f"stale-{index}",
                        "X-Finnos-Base-Version": "1",
                    },
                )).status_code == 409
                delete_headers = {
                    "X-Finnos-Operation-Id": f"entity-delete-{index}",
                    "X-Finnos-Base-Version": "2",
                }
                require_status(await client.delete(
                    f"/api{path}/{entity_id}", headers=delete_headers,
                ), 204)
                require_status(await client.delete(
                    f"/api{path}/{entity_id}", headers=delete_headers,
                ), 204)
            token = store.active_uid.set(uid)
            try:
                rev = await finance_revision(uid)
                assert rev == 24
                shadow_docs = list(owner.collection(
                    "_finance_shadow_outbox_v1"
                ).order_by("__name__").stream())
                assert len(shadow_docs) == rev
                assert sum(doc.to_dict()["is_noop"] for doc in shadow_docs) == 12
                assert not list(
                    owner.collection("_finance_month_shadows_v1").limit(1).stream()
                )
            finally:
                store.active_uid.reset(token)

    try:
        asyncio.run(scenario())
    finally:
        firebase_admin.delete_app(app)


def test_http_monthly_recurrence_scopes_atomic_replay_and_paid_history(monkeypatch):
    """Real ASGI + Firestore Emulator: future series edits are versioned."""
    uid = "test-scope-recurrences"
    with patch("google.auth.default",
               return_value=(AnonymousCredentials(), "demo-finnos")):
        app = firebase_admin.initialize_app(
            options={"projectId": "demo-finnos"}, name="scope-recurrences-http",
        )
        instance = firestore.client(app=app)
    parent = store.root(instance, uid)
    parent.collection("accounts").document("bank").set({"name": "Banco", "initial_balance_cents": 0})
    parent.collection("categories").document("shopping").set({"name": "Serviços"})
    monkeypatch.setattr(store, "client", lambda: instance)
    monkeypatch.setenv("VERCEL_ENV", "development")
    from api import index as api
    from finnos.routers import transactions
    monkeypatch.setattr(api, "verified_claims", lambda token, session=False: {
        "uid": uid, "email": "scope@example.invalid", "email_verified": True,
    })
    monkeypatch.setattr(transactions, "today_iso", lambda: "2026-10-28")

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=api.app),
            base_url="http://testserver", timeout=30,
            headers={
                "Origin": "http://testserver", "X-Finnos-User-Id": uid,
                "Authorization": "Bearer synthetic-only",
            },
        ) as client:
            initial = require_status(await client.post(
                "/api/transactions", json={
                    **payload("Internet", 100, date="2026-09-10", card_id=None),
                    "fixed": True, "recurrence": "mensal",
                },
                headers={"X-Finnos-Operation-Id": "recurrence-original"},
            ), 201)
            assert initial["recurrence_id"]
            assert initial["version"] == 1

            url = f"/api/transactions/{initial['id']}/recurrence"
            headers = {
                "X-Finnos-Operation-Id": "scope-only-november",
                "X-Finnos-Base-Version": "1",
            }
            data = {
                "scope": "esta", "effective_date": "2026-11-10",
                "changes": {"value": 125},
            }
            only = require_status(
                await client.post(url, json=data, headers=headers), 200,
            )
            again = require_status(
                await client.post(url, json=data, headers=headers), 200,
            )
            assert only["id"] == again["id"] != initial["id"]
            assert only["fixed"] is False
            assert only["recurrence_id"] == initial["recurrence_id"]
            assert only["status"] == "agendado"
            assert (await client.post(url, json={
                **data, "changes": {"value": 130},
            }, headers=headers)).status_code == 409

            next_data = {
                "scope": "proximas", "effective_date": "2026-12-10",
                "changes": {"value": 140},
            }
            future = require_status(await client.post(
                url, json=next_data, headers={
                    "X-Finnos-Operation-Id": "scope-all-after-december",
                    "X-Finnos-Base-Version": "1",
                },
            ), 200)
            assert future["fixed"] is True
            assert future["recurrence_id"] == initial["recurrence_id"]
            assert (await client.post(url, json={
                "scope": "todas", "effective_date": "2026-09-10",
                "changes": {"value": 150},
            }, headers={
                "X-Finnos-Operation-Id": "forbidden-paid-history",
                "X-Finnos-Base-Version": "1",
            })).status_code == 409

            future_url = f"/api/transactions/{future['id']}/recurrence"
            all_future = require_status(await client.post(
                future_url, json={
                    "scope": "todas", "effective_date": "2026-12-10",
                    "changes": {"value": 150},
                }, headers={
                    "X-Finnos-Operation-Id": "scope-future-root-change",
                    "X-Finnos-Base-Version": "1",
                },
            ), 200)
            assert all_future["id"] == future["id"]
            assert all_future["value"] == 150
            assert all_future["version"] == 2
            assert (await client.post(future_url, json={
                "scope": "todas", "effective_date": "2026-12-10",
                "changes": {"value": 160},
            }, headers={
                "X-Finnos-Operation-Id": "scope-stale-root",
                "X-Finnos-Base-Version": "1",
            })).status_code == 409

            from finnos.lib.recurrence import monthly_projection_sources
            transactions = [
                dict(store.decode(row.to_dict()), id=row.id)
                for row in parent.collection("transactions").stream()
            ]
            assert len(transactions) == 3
            assert monthly_projection_sources(transactions, "2026-11") == []
            assert monthly_projection_sources(transactions, "2026-12") == []
            january = monthly_projection_sources(transactions, "2027-01")
            assert len(january) == 1
            assert january[0][0]["value"] == 150
            assert (await client.get(
                f"/api/transactions/{initial['id']}"
            )).json()["value"] == 100
            assert len(list(parent.collection("sync_receipts").stream())) == 4

    try:
        asyncio.run(scenario())
    finally:
        firebase_admin.delete_app(app)
