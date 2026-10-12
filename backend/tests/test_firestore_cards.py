"""Card CRUD security regression tests for the isolated Firestore Preview API."""
from test_firestore_finance import finance, account, tx


def card(client, account_id=None, **changes):
    data = {
        "name": "Cartão teste", "institution": "Banco fictício",
        "limit": 1200.25, "closing_day": 20, "due_day": 7,
        "payment_account_id": account_id,
    }
    data.update(changes)
    return client.post("/api/cards", json=data)


def test_card_crud_preserves_cents_and_owner(finance):
    client, identity, db = finance
    a = account(client)
    response = card(client, a["id"])
    assert response.status_code == 201, response.text
    created = response.json()
    identifier = created["id"]
    assert created["limit"] == 1200.25
    assert created["payment_account_id"] == a["id"]
    assert any(p[-2:] == ("cards", identifier) and doc["limit_cents"] == 120025
               for p, doc in db.data.items())
    assert len(client.get("/api/cards").json()) == 1
    identity.update(uid="test-b", email="b@example.invalid")
    assert client.get("/api/cards").json() == []
    assert client.put(f"/api/cards/{identifier}", json={
        "name": "Invasão", "limit": 100, "closing_day": 20, "due_day": 7
    }).status_code == 404
    assert client.delete(f"/api/cards/{identifier}").status_code == 404
    assert card(client, a["id"]).status_code == 400
    identity.update(uid="test-a", email="a@example.invalid")
    changed = client.put(f"/api/cards/{identifier}", json={
        "name": "Atualizado", "limit": 2000.30, "closing_day": 21,
        "due_day": 8, "payment_account_id": a["id"]
    })
    assert changed.status_code == 200, changed.text
    assert changed.json()["limit"] == 2000.30
    assert client.delete(f"/api/cards/{identifier}").status_code == 204
    assert client.get("/api/cards").json() == []


def test_card_references_and_linked_transactions(finance):
    client, identity, _ = finance
    a = account(client)
    assert card(client, "missing-account").status_code == 400
    c = card(client, a["id"]).json()
    assert tx(client, a["id"], type="despesa", card_id=c["id"], value=15.11).status_code == 201
    assert client.delete(f"/api/cards/{c['id']}").status_code == 409
    assert len(client.get("/api/cards").json()) == 1


def test_card_mutation_requires_same_origin(finance):
    client, _, _ = finance
    response = client.post("/api/cards", json={
        "name": "Outro", "limit": 100, "closing_day": 20, "due_day": 7
    }, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
