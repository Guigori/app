"""How many Firestore documents each screen's routes read, measured on the real app against the Firestore
Emulator with synthetic data (demo project, synthetic UID). Runs only in CI's emulator job; prints a table to the
job summary so every PR shows the cost per route. Nothing here touches a real project."""
import asyncio
import os
from datetime import date, timedelta
from unittest.mock import patch

import firebase_admin
import httpx
import pytest
from firebase_admin import firestore
from google.auth.credentials import AnonymousCredentials

from finnos.lib import db as store
from finnos.lib import tx_pack

pytestmark = pytest.mark.skipif(
    not (os.getenv("FIRESTORE_EMULATOR_HOST") and os.getenv("FIREBASE_PROJECT_ID") == "demo-finnos"),
    reason="Medição de leituras somente no Firestore Emulator demo-finnos.",
)

UID = "test-reads-baseline"
HEADERS = {"Origin": "http://testserver", "Authorization": "Bearer synthetic", "X-Finnos-User-Id": UID}
TODAY = "2026-11-15"
N = 300

# Read budget (300 lançamentos): CI fails when a change makes a screen read more than this. "again" is opening
# it once more with nothing new; "after" is opening it right after one new lançamento.
BUDGET_AGAIN = 3
BUDGET_AFTER = 45
UNCACHED = {"/api/transactions?start_date=2026-11-01&end_date=2026-11-30": 25}   # list of the month: one read each

ROUTES = [
    ("Início · resumo do mês", "/api/dashboard?month=2026-11"),
    ("Início · resumo do mês anterior", "/api/dashboard?month=2026-10"),
    ("Calendário", "/api/analytics/calendar?month=2026-11"),
    ("Evolução do saldo", "/api/analytics/balance-history?month=2026-11"),
    ("Contas", "/api/accounts"),
    ("Cartões", "/api/cards"),
    ("Lançamentos do mês", "/api/transactions?start_date=2026-11-01&end_date=2026-11-30"),
    ("Radar", "/api/radar"),
    ("Notificações", "/api/notifications"),
    ("Assinaturas", "/api/subscriptions"),
]

NEW_TX = {"name": "Padaria", "value": 12.5, "type": "despesa", "status": "pago", "date": "2026-11-14",
          "account_id": "bank", "category_id": "food"}


def seed(instance, uid=UID, n=N):
    owner = store.root(instance, uid)
    owner.collection("_meta").document("finance").set({"revision": 1})
    owner.collection("accounts").document("bank").set({"name": "Conta", "type": "corrente", "institution": "Banco", "initial_balance_cents": 500000, "active": True, "created_at": "2025-12-01T00:00:00+00:00"})
    owner.collection("categories").document("food").set({"name": "Mercado", "color": "#84cc16", "icon": "shopping-cart", "group": "necessidades", "monthly_budget_cents": 60000, "monthly_goal_cents": 0, "created_at": "2025-12-01T00:00:00+00:00"})
    owner.collection("cards").document("card").set({
        "name": "Cartão", "institution": "Banco", "limit_cents": 500000, "closing_day": 3, "due_day": 10,
        "payment_account_id": "bank", "active": True,
    })
    start = date(2025, 12, 1)
    batch = instance.batch()
    for i in range(n):
        day = start + timedelta(days=(i * 350) // n)
        on_card = i % 3 == 0
        batch.set(owner.collection("transactions").document(f"t{i:04d}"), {
            "name": f"Compra {i % 25}", "value_cents": 1000 + (i % 40) * 137, "type": "despesa" if i % 10 else "receita",
            "status": "pago", "date": day.isoformat(), "account_id": "bank", "card_id": "card" if on_card and i % 10 else None,
            "category_id": "food", "created_at": f"{day.isoformat()}T12:00:00+00:00", "version": 1,
        })
        if i % 200 == 199:
            batch.commit()
            batch = instance.batch()
    batch.commit()


def test_reads_per_route(monkeypatch):
    with patch("google.auth.default", return_value=(AnonymousCredentials(), "demo-finnos")):
        demo = firebase_admin.initialize_app(options={"projectId": "demo-finnos"}, name="reads-baseline")
        instance = firestore.client(app=demo)
    seed(instance)
    monkeypatch.setattr(store, "client", lambda: instance)
    monkeypatch.setenv("VERCEL_ENV", "development")
    from api import index as api
    import finnos.lib.dates as dates
    monkeypatch.setattr(api, "verified_claims", lambda token, session=False: {"uid": UID, "email": "t@example.invalid", "email_verified": True})
    monkeypatch.setattr(dates, "today_iso", lambda: TODAY)

    rows, changes = [], []

    async def scenario():
        transport = httpx.ASGITransport(app=api.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", headers=HEADERS, timeout=60) as client:
            async def get(url):
                # Each request as if it reached a fresh server (no pack kept in memory): the cautious count.
                tx_pack._memo.clear()
                return await client.get(url)

            for label, url in ROUTES:
                first = await get(url)
                again = await get(url)
                rows.append([label, url, first.status_code, first.headers.get("X-Finnos-Reads", "?"), again.headers.get("X-Finnos-Reads", "?")])
            # One new lançamento, then every screen again: what a person pays after each registro.
            created = await client.post("/api/transactions", json=NEW_TX, headers={"X-Finnos-Operation-Id": "reads-after-change"})
            assert created.status_code == 201, created.text[:500]
            changes.append(created.json()["id"])
            for row in rows:
                after = await get(row[1])
                row.append(after.headers.get("X-Finnos-Reads", "?"))
    asyncio.run(scenario())

    table = [f"### Leituras do Firestore por rota ({N} lançamentos sintéticos)", "", "| Tela | Rota | Status | 1ª abertura | Abrir de novo (sem mudança) | Depois de 1 lançamento novo |", "| --- | --- | --- | --- | --- | --- |"]
    table += [f"| {label} | `{url}` | {status} | {reads} | {again} | {after} |" for label, url, status, reads, again, after in rows]
    totals = [sum(int(r[i]) for r in rows if str(r[i]).isdigit()) for i in (3, 4, 5)]
    table += [f"| **Total** | | | **{totals[0]}** | **{totals[1]}** | **{totals[2]}** |", ""]
    text = "\n".join(table)
    print(text)
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    assert all(row[2] == 200 for row in rows), rows
    over = []
    for label, url, _, _, again, after in rows:
        limit_again = UNCACHED.get(url, BUDGET_AGAIN)
        limit_after = UNCACHED.get(url, BUDGET_AFTER)
        if not str(again).isdigit() or int(again) > limit_again:
            over.append(f"{label}: abrir de novo leu {again} (limite {limit_again})")
        if not str(after).isdigit() or int(after) > limit_after:
            over.append(f"{label}: depois de um lançamento leu {after} (limite {limit_after})")
    assert not over, "Orçamento de leituras excedido:\n" + "\n".join(over)
