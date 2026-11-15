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

pytestmark = pytest.mark.skipif(
    not (os.getenv("FIRESTORE_EMULATOR_HOST") and os.getenv("FIREBASE_PROJECT_ID") == "demo-finnos"),
    reason="Medição de leituras somente no Firestore Emulator demo-finnos.",
)

UID = "test-reads-baseline"
HEADERS = {"Origin": "http://testserver", "Authorization": "Bearer synthetic", "X-Finnos-User-Id": UID}
TODAY = "2026-11-15"
N = 300

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


def seed(instance):
    owner = store.root(instance, UID)
    owner.collection("_meta").document("finance").set({"revision": 1})
    owner.collection("accounts").document("bank").set({"name": "Conta", "type": "corrente", "institution": "Banco", "initial_balance_cents": 500000, "active": True, "created_at": "2025-12-01T00:00:00+00:00"})
    owner.collection("categories").document("food").set({"name": "Mercado", "color": "#84cc16", "icon": "shopping-cart", "group": "necessidades", "monthly_budget_cents": 60000, "monthly_goal_cents": 0, "created_at": "2025-12-01T00:00:00+00:00"})
    owner.collection("cards").document("card").set({
        "name": "Cartão", "institution": "Banco", "limit_cents": 500000, "closing_day": 3, "due_day": 10,
        "payment_account_id": "bank", "active": True,
    })
    start = date(2025, 12, 1)
    batch = instance.batch()
    for i in range(N):
        day = start + timedelta(days=(i * 350) // N)
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

    rows = []

    async def scenario():
        transport = httpx.ASGITransport(app=api.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", headers=HEADERS, timeout=60) as client:
            for label, url in ROUTES:
                response = await client.get(url)
                rows.append((label, url, response.status_code, response.headers.get("X-Finnos-Reads", "?")))
    asyncio.run(scenario())

    table = [f"### Leituras do Firestore por rota ({N} lançamentos sintéticos)", "", "| Tela | Rota | Status | Leituras |", "| --- | --- | --- | --- |"]
    table += [f"| {label} | `{url}` | {status} | {reads} |" for label, url, status, reads in rows]
    total = sum(int(r[3]) for r in rows if str(r[3]).isdigit())
    table += [f"| **Total** | | | **{total}** |", ""]
    text = "\n".join(table)
    print(text)
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    # The table is the result; a route that fails on the synthetic seed shows its status instead of stopping CI.
    assert sum(status < 500 for _, _, status, _ in rows) >= len(rows) // 2, rows
