"""The monthly pack (finnos.lib.tx_pack) against the Firestore Emulator: after every kind of write it must hold
exactly what a full read of the collection returns, and every screen must answer the same with and without it.
Synthetic demo project and UIDs only; runs in CI's emulator job."""
import asyncio
import os
import re
from unittest.mock import patch

import firebase_admin
import httpx
import pytest
from firebase_admin import firestore
from google.auth.credentials import AnonymousCredentials
from google.cloud.firestore_v1 import SERVER_TIMESTAMP

from finnos.lib import db as store
from finnos.lib import read_meter, tx_pack
from finnos.lib.account_balances import _revision

pytestmark = pytest.mark.skipif(
    not (os.getenv("FIRESTORE_EMULATOR_HOST") and os.getenv("FIREBASE_PROJECT_ID") == "demo-finnos"),
    reason="Pacote mensal testado somente no Firestore Emulator demo-finnos.",
)


@pytest.fixture(scope="module")
def instance():
    with patch("google.auth.default", return_value=(AnonymousCredentials(), "demo-finnos")):
        demo = firebase_admin.initialize_app(options={"projectId": "demo-finnos"}, name="tx-pack")
        return firestore.client(app=demo)


def full(parent):
    return sorted((s.id, s.to_dict()) for s in parent.collection("transactions").stream())


def packed(parent):
    meta = parent.collection("_meta").document("tx_pack").get().to_dict()
    assert meta and not meta.get("disabled"), meta
    assert meta["rev"] == _revision(parent), (meta["rev"], _revision(parent))
    return tx_pack.current_pack(parent, meta["rev"])


def seed(instance, uid, n=40):
    from finnos.tests.test_reads_baseline_emulator import seed as seed_baseline
    seed_baseline(instance, uid=uid, n=n)
    return store.root(instance, uid)


def test_pack_follows_every_write(instance):
    uid = "test-pack-writes"
    parent = seed(instance, uid)
    rev = _revision(parent)
    first = tx_pack.raw_transactions(parent, rev)          # streams and builds
    assert first == full(parent)

    read_meter.install()
    meter = read_meter.start()
    assert tx_pack.raw_transactions(parent, rev) == first  # same server, same revision: from memory
    assert meter.reads == 0, meter.reads
    tx_pack._memo.clear()                                  # another server: the meta and one document per month
    again = tx_pack.raw_transactions(parent, rev)
    reads = meter.reads
    months = len(parent.collection("_meta").document("tx_pack").get().to_dict()["months"])
    assert reads == months + 1, (reads, months)
    assert again == full(parent)

    col = parent.collection("transactions")
    base = {"name": "Novo", "value_cents": 990, "type": "despesa", "status": "pago", "date": "2026-11-02",
            "account_id": "bank", "category_id": "food", "card_id": None, "version": 1}
    writes = [
        ("create", lambda tr: tr.create(col.document("n1"), dict(base))),
        ("set", lambda tr: tr.set(col.document("n2"), dict(base, date="2026-10-30"))),
        ("update", lambda tr: tr.update(col.document("n1"), {"value_cents": 1990})),
        ("merge into another month", lambda tr: tr.set(col.document("n1"), {"date": "2025-12-31"}, merge=True)),
        ("server timestamp", lambda tr: tr.set(col.document("n3"), dict(base, created_at=SERVER_TIMESTAMP))),
        ("delete", lambda tr: tr.delete(col.document("t0003"))),
        ("several at once", lambda tr: (tr.delete(col.document("n2")), tr.create(col.document("n4"), dict(base, date="2027-01-05")))),
        ("no lançamento", lambda tr: None),
    ]
    for label, write in writes:
        store.atomic(instance, uid, write)
        tx_pack._memo.clear()
        assert packed(parent) == full(parent), label


def test_stale_pack_is_never_read(instance):
    uid = "test-pack-stale"
    parent = seed(instance, uid)
    rev = _revision(parent)
    tx_pack.raw_transactions(parent, rev)
    # A write that does not go through db.atomic's recorder: the revision moves, the pack does not.
    parent.collection("transactions").document("x1").set({"name": "Fora", "value_cents": 1, "type": "despesa",
                                                         "status": "pago", "date": "2026-11-03", "account_id": "bank"})
    parent.collection("_meta").document("finance").set({"revision": rev + 1})
    assert tx_pack.current_pack(parent, rev + 1) is None
    assert tx_pack.raw_transactions(parent, rev + 1) == full(parent)   # streamed and rebuilt
    assert packed(parent) == full(parent)
    # The next write through db.atomic moves the rebuilt pack forward.
    store.atomic(instance, uid, lambda tr: tr.delete(parent.collection("transactions").document("x1")))
    assert packed(parent) == full(parent)


def test_disabled_pack_falls_back(instance, monkeypatch):
    uid = "test-pack-big"
    parent = seed(instance, uid)
    monkeypatch.setattr(tx_pack, "MAX_MONTH_BYTES", 10)
    rev = _revision(parent)
    assert tx_pack.raw_transactions(parent, rev) == full(parent)
    assert parent.collection("_meta").document("tx_pack").get().to_dict().get("disabled") is True
    tx_pack._memo.clear()
    assert tx_pack.current_pack(parent, rev) is None
    assert tx_pack.raw_transactions(parent, rev) == full(parent)


ROUTES = [
    "/api/dashboard?month=2026-11", "/api/dashboard?month=2026-06", "/api/analytics/calendar?month=2026-11",
    "/api/analytics/balance-history?month=2026-11", "/api/analytics/trends", "/api/analytics/flow?month=2026-11",
    "/api/analytics/budget?month=2026-11", "/api/accounts", "/api/cards", "/api/cards/card/invoice?month=2026-11",
    "/api/radar", "/api/notifications", "/api/subscriptions", "/api/budgets/current",
]


def test_screens_answer_the_same_with_and_without_the_pack(instance, monkeypatch):
    uid = "test-pack-routes"
    seed(instance, uid, n=120)
    monkeypatch.setattr(store, "client", lambda: instance)
    monkeypatch.setenv("VERCEL_ENV", "development")
    monkeypatch.setenv("FINNOS_RESPONSE_CACHE", "0")
    from api import index as api
    import finnos.lib.dates as dates
    monkeypatch.setattr(api, "verified_claims", lambda token, session=False: {"uid": uid, "email": "t@example.invalid", "email_verified": True})
    monkeypatch.setattr(dates, "today_iso", lambda: "2026-11-15")
    headers = {"Origin": "http://testserver", "Authorization": "Bearer synthetic", "X-Finnos-User-Id": uid}
    new = {"name": "Padaria", "value": 12.5, "type": "despesa", "status": "pago", "date": "2026-11-14",
           "account_id": "bank", "category_id": "food"}

    async def answers(client):
        out = {}
        for url in ROUTES:
            response = await client.get(url)
            # Times stamped at the moment of the answer ("…T12:00:07.307902Z") are not data.
            out[url] = (response.status_code, re.sub(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+(Z|\+00:00)", "<agora>", response.text))
        return out

    async def scenario():
        transport = httpx.ASGITransport(app=api.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", headers=headers, timeout=60) as client:
            for step in range(3):
                if step == 1:
                    r = await client.post("/api/transactions", json=new, headers={"X-Finnos-Operation-Id": "pack-1"})
                    assert r.status_code == 201, r.text[:500]
                    new_id = r.json()["id"]
                if step == 2:
                    r = await client.put(f"/api/transactions/{new_id}", json=dict(new, value=40, date="2026-10-20"))
                    assert r.status_code == 200, r.text[:500]
                monkeypatch.setenv("FINNOS_TX_PACK", "1")
                with_pack = await answers(client)
                monkeypatch.setenv("FINNOS_TX_PACK", "0")
                without = await answers(client)
                monkeypatch.setenv("FINNOS_TX_PACK", "1")
                for url in ROUTES:
                    assert with_pack[url] == without[url], (step, url, with_pack[url][1][:300], without[url][1][:300])
    asyncio.run(scenario())


def test_daily_export_for_the_mongo_copy(instance, monkeypatch):
    import base64
    import gzip
    import json
    from finnos.routers.backup import checksum
    uid = "test-pack-export"
    seed(instance, uid, n=30)
    monkeypatch.setattr(store, "client", lambda: instance)
    monkeypatch.setenv("VERCEL_ENV", "development")
    monkeypatch.setenv("CRON_SECRET", "c" * 24)
    from api import index as api
    auth = {"Authorization": "Bearer " + "c" * 24, "Origin": "http://testserver"}

    async def export(known):
        transport = httpx.ASGITransport(app=api.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=60) as client:
            items, after = [], None
            while True:
                r = await client.post("/api/finance/backups-export", json={"after": after, "limit": 10, "known": known}, headers=auth)
                assert r.status_code == 200, r.text[:500]
                body = r.json()
                items += body["items"]
                after = body["next"]
                if not after:
                    return {i["uid"]: i for i in items}

    first = asyncio.run(export({}))[uid]
    data = json.loads(gzip.decompress(base64.b64decode(first["gzip_b64"])))
    assert data["checksum_sha256"] == checksum(data["collections"]) == first["checksum_sha256"]
    assert len(data["collections"]["transactions"]) == 30
    again = asyncio.run(export({uid: first["revision"]}))[uid]
    assert again == {"uid": uid, "revision": first["revision"], "unchanged": True}


def test_writes_fixtures_for_the_device_copy_parity(instance, monkeypatch):
    """Writes the device copy (/api/finance/mirror) and the server's answers for the same revision; the job then runs
    src/lib/mirror.parity.test.ts, which computes the same screens with the app's local engine and compares."""
    import json
    out = os.getenv("SHADOW_FIXTURES")
    if not out:
        pytest.skip("SHADOW_FIXTURES não definido")
    uid = "test-mirror-parity"
    seed(instance, uid, n=150)
    monkeypatch.setattr(store, "client", lambda: instance)
    monkeypatch.setenv("VERCEL_ENV", "development")
    from api import index as api
    import finnos.lib.dates as dates
    monkeypatch.setattr(api, "verified_claims", lambda token, session=False: {"uid": uid, "email": "t@example.invalid", "email_verified": True})
    from datetime import datetime as real_datetime

    class FixedDay(real_datetime):
        """today_iso() everywhere (imported by name in many modules) answers the app's test day."""
        @classmethod
        def now(cls, tz=None):
            return real_datetime(2026, 11, 15, 12, 0, tzinfo=tz)

    monkeypatch.setattr(dates, "datetime", FixedDay)
    headers = {"Origin": "http://testserver", "Authorization": "Bearer synthetic", "X-Finnos-User-Id": uid}
    extra = [
        {"name": "Aluguel", "value": 1500, "type": "despesa", "status": "pendente", "date": "2026-11-20", "account_id": "bank", "category_id": "food"},
        {"name": "Notebook", "value": 3000, "type": "despesa", "status": "pago", "date": "2026-10-10", "account_id": "bank",
         "card_id": "card", "category_id": "food", "installment": True, "total_installments": 6, "current_installment": 1},
        {"name": "Salário", "value": 5200, "type": "receita", "status": "agendado", "date": "2026-11-28", "account_id": "bank", "category_id": "food"},
    ]
    screens = {"dashboard": ["/api/dashboard?month=2026-11", "/api/dashboard?month=2026-10", "/api/dashboard?month=2026-06"],
               "calendar": ["/api/analytics/calendar?month=2026-11", "/api/analytics/calendar?month=2026-12"],
               "balanceHistory": ["/api/analytics/balance-history?month=2026-11", "/api/analytics/balance-history?month=2026-09"],
               "accounts": ["/api/accounts"],
               # Compared whole (lib/mirror.ts compareWhole); reported, not yet required to match.
               "trends": ["/api/analytics/trends?months=6"], "budget": ["/api/analytics/budget?month=2026-11"],
               "flow": ["/api/analytics/flow?month=2026-11"], "cards": ["/api/cards"],
               "invoice": ["/api/cards/card/invoice"], "subscriptions": ["/api/subscriptions"],
               "transactions": ["/api/transactions?month=2026-11"], "radar": ["/api/radar"],
               "notifications": ["/api/notifications"], "categories": ["/api/categories"],
               "institutions": ["/api/institutions"]}

    async def scenario():
        transport = httpx.ASGITransport(app=api.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", headers=headers, timeout=60) as client:
            for n, body in enumerate(extra):
                r = await client.post("/api/transactions", json=body, headers={"X-Finnos-Operation-Id": f"parity-{n}"})
                assert r.status_code == 201, r.text[:500]
            mirror = (await client.get("/api/finance/mirror")).json()
            answers = {}
            for screen, urls in screens.items():
                for url in urls:
                    r = await client.get(url)
                    if screen not in ("dashboard", "calendar", "balanceHistory", "accounts") and r.status_code != 200:
                        continue
                    assert r.status_code == 200, (url, r.text[:300])
                    if screen in ("dashboard", "calendar", "balanceHistory", "accounts"):
                        assert r.headers.get("X-Finnos-Revision") == str(mirror["revision"]), url
                    answers.setdefault(screen, {})[url] = r.json()
            return mirror, answers

    mirror, answers = asyncio.run(scenario())
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "mirror.json"), "w", encoding="utf-8") as fh:
        json.dump(mirror, fh)
    with open(os.path.join(out, "answers.json"), "w", encoding="utf-8") as fh:
        json.dump({"today": "2026-11-15", "answers": answers}, fh)


def test_device_copy_follows_the_change_log(instance, monkeypatch):
    """Old copy + /finance/mirror/changes == the new full copy, after creates, edits and deletes; and a gap in the
    log answers full."""
    uid = "test-mirror-changes"
    parent = seed(instance, uid, n=40)
    monkeypatch.setattr(store, "client", lambda: instance)
    monkeypatch.setenv("VERCEL_ENV", "development")
    monkeypatch.setenv("FINNOS_RESPONSE_CACHE", "0")
    from api import index as api
    monkeypatch.setattr(api, "verified_claims", lambda token, session=False: {"uid": uid, "email": "t@example.invalid", "email_verified": True})
    headers = {"Origin": "http://testserver", "Authorization": "Bearer synthetic", "X-Finnos-User-Id": uid}
    col = parent.collection("transactions")
    base = {"name": "Novo", "value_cents": 990, "type": "despesa", "status": "pago", "date": "2026-11-02",
            "account_id": "bank", "category_id": "food", "version": 1}

    def apply(copy, delta):
        out = {name: {row["id"]: row for row in rows} for name, rows in copy.items()}
        for name, rows in delta["upserts"].items():
            out.setdefault(name, {}).update({row["id"]: row for row in rows})
        for name, ids in delta["deletes"].items():
            for doc_id in ids:
                out.get(name, {}).pop(doc_id, None)
        return {name: sorted(rows.values(), key=lambda r: str(r["id"])) for name, rows in out.items()}

    async def scenario():
        transport = httpx.ASGITransport(app=api.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", headers=headers, timeout=60) as client:
            old = (await client.get("/api/finance/mirror")).json()
            store.atomic(instance, uid, lambda tr: tr.create(col.document("c1"), dict(base)))
            store.atomic(instance, uid, lambda tr: tr.update(col.document("t0002"), {"value_cents": 4321}))
            store.atomic(instance, uid, lambda tr: (tr.delete(col.document("t0003")),
                                                   tr.update(parent.collection("accounts").document("bank"), {"name": "Banco novo"})))
            delta = (await client.get(f"/api/finance/mirror/changes?since={old['revision']}")).json()
            new = (await client.get("/api/finance/mirror")).json()
            assert delta["full"] is False and delta["revision"] == new["revision"] == old["revision"] + 3, delta
            applied = apply(old["collections"], delta)
            for name, rows in new["collections"].items():
                assert applied.get(name, []) == rows, name
            same = (await client.get(f"/api/finance/mirror/changes?since={new['revision']}")).json()
            assert same == {"full": False, "since": new["revision"], "revision": new["revision"], "upserts": {}, "deletes": {}}
            # A revision raised without a log entry (a write the log never saw): the device must download it all.
            parent.collection("_meta").document("finance").set({"revision": new["revision"] + 1})
            gap = (await client.get(f"/api/finance/mirror/changes?since={new['revision']}")).json()
            assert gap["full"] is True
    asyncio.run(scenario())
