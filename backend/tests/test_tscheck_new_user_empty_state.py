"""Criterion: Usuário recém-cadastrado começa vazio, com estados vazios corretos.

New users must have zero accounts/transactions but 15 default categories already
split across necessidades/desejos/metas.
"""
import uuid


def _signup(client):
    email = f"tscheck-empty-{uuid.uuid4().hex[:10]}@finnos.app"
    resp = client.post(
        "/auth/signup",
        json={"name": "Tscheck Empty", "email": email, "password": "senha123"},
    )
    assert resp.status_code == 200, resp.text
    return resp.cookies


def test_new_user_starts_with_no_accounts_no_transactions(client):
    cookies = _signup(client)

    accounts = client.get("/accounts", cookies=cookies)
    assert accounts.status_code == 200
    assert accounts.json() == []

    transactions = client.get("/transactions", cookies=cookies)
    assert transactions.status_code == 200
    assert transactions.json() == []


def test_new_user_has_15_default_categories_grouped(client):
    cookies = _signup(client)

    categories = client.get("/categories", cookies=cookies)
    assert categories.status_code == 200
    data = categories.json()
    assert len(data) == 15, data

    groups = {c["group"] for c in data}
    assert groups.issubset({"necessidades", "desejos", "metas"})
    assert "necessidades" in groups
    assert "desejos" in groups
    assert "metas" in groups


def test_new_user_dashboard_shows_zero_balance_no_fake_comparison(client):
    cookies = _signup(client)

    dash = client.get("/dashboard?month=2026-10", cookies=cookies)
    assert dash.status_code == 200, dash.text
    body = dash.json()
    assert body["total_balance"] == 0
    assert body["income"] == 0
    assert body["expense"] == 0
    # no prior month data -> comparison must be null, never a fabricated percent
    assert body.get("prev_income") in (None, 0)
    assert body.get("prev_expense") in (None, 0)
