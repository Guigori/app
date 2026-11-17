"""Orçamento por mês: plano e retrato do fechamento, guardados por UID e por mês (sem tocar em outros módulos)."""
from copy import deepcopy
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from finnos.routers import budget_months
from finnos.routers.auth import require_user


class Store:
    def __init__(self):
        self.items = {}

    def find(self, query):
        rows = [deepcopy(v) for (uid, _), v in self.items.items() if uid == query["user_id"]]
        return SimpleNamespace(to_list=lambda n: _ret(rows[:n]))

    async def find_one(self, query):
        doc = self.items.get((query["user_id"], query["id"]))
        return deepcopy(doc) if doc else None

    async def insert_one(self, doc):
        self.items[(doc["user_id"], doc["id"])] = deepcopy(doc)

    async def update_one(self, query, update):
        self.items[(query["user_id"], query["id"])].update(update["$set"])
        return SimpleNamespace(matched_count=1)

    async def delete_one(self, query):
        return SimpleNamespace(deleted_count=int(self.items.pop((query["user_id"], query["id"]), None) is not None))


async def _ret(value):
    return value


def client_for(uid, plans, closings):
    app = FastAPI()
    app.include_router(budget_months.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": uid}
    return TestClient(app)


def test_plan_and_closing_are_per_user_and_per_month(monkeypatch):
    plans, closings = Store(), Store()
    monkeypatch.setattr(budget_months, "db", SimpleNamespace(budget_plans=plans, budget_closings=closings))
    with client_for("alice", plans, closings) as c:
        plan = {"approved": ["fx:Luz:2026-12-22"], "ignored": ["tx:al"], "saving": {"g1": 400}, "planned_income": 5800, "planned_bills": 2035, "planned_saving": 400, "planned_spend": 3365}
        r = c.put("/api/budgets/plans/2026-12", json=plan)
        assert r.status_code == 200, r.text
        assert r.json()["month"] == "2026-12" and r.json()["planned_income"] == 5800
        # replaying the same save (offline queue) keeps one document
        assert c.put("/api/budgets/plans/2026-12", json={**plan, "planned_spend": 3000}).status_code == 200
        listed = c.get("/api/budgets/plans").json()
        assert len(listed) == 1 and listed[0]["planned_spend"] == 3000
        assert "user_id" not in listed[0]

        assert c.put("/api/budgets/plans/2026-13", json=plan).status_code == 422
        assert c.put("/api/budgets/plans/2026-12", json={**plan, "transactions": []}).status_code == 422

        closing = {"closed_at": "2026-11-01T10:00:00Z", "earned": 6050, "spent": 5750, "result": 300, "daily_planned": 1350, "daily_spent": 1410,
                   "planned_income": 6100, "planned_bills": 900, "allocation": [{"id": "meta:g1", "kind": "meta", "name": "Viagem", "value": 150}],
                   "categories": [{"category_id": "merc", "name": "Mercado", "spent": 820, "limit": 900}]}
        assert c.put("/api/budgets/closings/2026-10", json=closing).status_code == 200
        assert c.get("/api/budgets/closings").json()[0]["allocation"][0]["name"] == "Viagem"

    with client_for("bob", plans, closings) as c:
        assert c.get("/api/budgets/plans").json() == []
        assert c.get("/api/budgets/closings").json() == []
        assert c.delete("/api/budgets/closings/2026-10").status_code == 204

    with client_for("alice", plans, closings) as c:
        assert len(c.get("/api/budgets/closings").json()) == 1
        assert c.delete("/api/budgets/closings/2026-10").status_code == 204
        assert c.get("/api/budgets/closings").json() == []


def test_special_plans_keep_only_dates_limits_and_the_linked_goal(monkeypatch):
    plans, closings, specials = Store(), Store(), Store()
    monkeypatch.setattr(budget_months, "db", SimpleNamespace(budget_plans=plans, budget_closings=closings, budget_specials=specials))
    sp = {"name": "Praia no Carnaval", "kind": "Férias", "start": "2027-02-12", "end": "2027-02-17", "amount": 1800, "source": "nova",
          "goal_id": "g9", "goal_name": "Praia no Carnaval", "monthly": 450, "categories": [{"category_id": "hosp", "name": "Hospedagem", "limit": 900}]}
    with client_for("alice", plans, closings) as c:
        r = c.put("/api/budgets/specials/sp-1", json=sp)
        assert r.status_code == 200, r.text
        assert r.json()["id"] == "sp-1" and "month" not in r.json()
        assert c.put("/api/budgets/specials/sp-1", json={**sp, "monthly": 500}).status_code == 200
        listed = c.get("/api/budgets/specials").json()
        assert len(listed) == 1 and listed[0]["monthly"] == 500
        assert c.put("/api/budgets/specials/sp-2", json={**sp, "end": "2027-02-01"}).status_code == 422
        assert c.put("/api/budgets/specials/sp-2", json={**sp, "kind": "Outro"}).status_code == 422
        assert c.put("/api/budgets/specials/Bad Id", json=sp).status_code == 422
    with client_for("bob", plans, closings) as c:
        assert c.get("/api/budgets/specials").json() == []
    with client_for("alice", plans, closings) as c:
        assert c.delete("/api/budgets/specials/sp-1").status_code == 204
        assert c.get("/api/budgets/specials").json() == []


def test_plan_keeps_the_special_plans_the_person_included(monkeypatch):
    plans, closings = Store(), Store()
    monkeypatch.setattr(budget_months, "db", SimpleNamespace(budget_plans=plans, budget_closings=closings))
    with client_for("alice", plans, closings) as c:
        assert c.put("/api/budgets/plans/2027-02", json={"specials": ["sp-1"]}).status_code == 200
        assert c.get("/api/budgets/plans").json()[0]["specials"] == ["sp-1"]


def test_closing_keeps_note_and_what_happened_to_each_estimate(monkeypatch):
    plans, closings = Store(), Store()
    monkeypatch.setattr(budget_months, "db", SimpleNamespace(budget_plans=plans, budget_closings=closings))
    with client_for("alice", plans, closings) as c:
        body = {"closed_at": "2026-11-01T10:00:00Z", "earned": 1, "spent": 1, "result": 0, "daily_planned": 0, "daily_spent": 0, "note": "Aniversário da Ana",
                "estimates": [{"name": "Freela", "type": "receita", "value": 400, "outcome": "aberto"}, {"name": "Aluguel", "type": "despesa", "value": 1400, "outcome": "aconteceu"}]}
        assert c.put("/api/budgets/closings/2026-10", json=body).status_code == 200
        got = c.get("/api/budgets/closings").json()[0]
        assert got["note"] == "Aniversário da Ana" and got["estimates"][0]["outcome"] == "aberto"
        assert c.put("/api/budgets/closings/2026-10", json={**body, "estimates": [{"name": "X", "type": "receita", "value": 1, "outcome": "talvez"}]}).status_code == 422


def test_plan_keeps_reminders(monkeypatch):
    plans, closings = Store(), Store()
    monkeypatch.setattr(budget_months, "db", SimpleNamespace(budget_plans=plans, budget_closings=closings))
    with client_for("alice", plans, closings) as c:
        r = {"id": "r1", "date": "2026-12-18", "text": "Cancelar Streaming", "kind": "assinatura"}
        assert c.put("/api/budgets/plans/2026-12", json={"reminders": [r]}).status_code == 200
        assert c.get("/api/budgets/plans").json()[0]["reminders"][0]["text"] == "Cancelar Streaming"
        assert c.put("/api/budgets/plans/2026-12", json={"reminders": [{**r, "date": "2026-12-40"}]}).status_code == 422


def test_plan_keeps_expected_values(monkeypatch):
    plans, closings = Store(), Store()
    monkeypatch.setattr(budget_months, "db", SimpleNamespace(budget_plans=plans, budget_closings=closings))
    with client_for("alice", plans, closings) as c:
        assert c.put("/api/budgets/plans/2026-12", json={"expected": {"tx:f": 900}}).status_code == 200
        assert c.get("/api/budgets/plans").json()[0]["expected"] == {"tx:f": 900}
