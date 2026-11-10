"""Receipt photo: stored per lançamento, only for its owner, only images."""
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from finnos.lib import db as store
from finnos.routers import transactions
from finnos.routers.auth import require_user

IMG = "data:image/jpeg;base64," + "A" * 64


class Doc:
    def __init__(self, bucket, key): self.bucket, self.key = bucket, key
    def set(self, data): self.bucket[self.key] = data
    def get(self):
        data = self.bucket.get(self.key)
        return SimpleNamespace(exists=data is not None, to_dict=lambda: dict(data or {}))
    def delete(self): self.bucket.pop(self.key, None)


class Owner:
    def __init__(self, files): self.files = files
    def collection(self, name):
        assert name == "attachments"
        return SimpleNamespace(document=lambda key: Doc(self.files, key))


class FakeTransactions:
    def __init__(self): self.rows = {("A", "tx"): {"id": "tx", "user_id": "A", "attachment": None}}
    async def find_one(self, q): return self.rows.get((q["user_id"], q["id"]))
    async def update_one(self, q, u):
        self.rows[(q["user_id"], q["id"])].update(u["$set"])


def make(uid, monkeypatch, files, txs):
    monkeypatch.setattr(store, "scoped", lambda q: q["user_id"])
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, owner: Owner(files.setdefault(owner, {})))
    monkeypatch.setattr(transactions, "db", SimpleNamespace(transactions=txs))
    app = FastAPI()
    app.include_router(transactions.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: {"id": uid}
    return TestClient(app)


def test_attach_read_and_remove(monkeypatch):
    files, txs = {}, FakeTransactions()
    c = make("A", monkeypatch, files, txs)
    assert c.put("/api/transactions/tx/attachment", json={"data_url": IMG}).status_code == 200
    assert txs.rows[("A", "tx")]["attachment"] == "finnos:attachment"
    assert c.get("/api/transactions/tx/attachment").json()["data_url"] == IMG
    assert c.delete("/api/transactions/tx/attachment").status_code == 204
    assert txs.rows[("A", "tx")]["attachment"] is None
    assert c.get("/api/transactions/tx/attachment").status_code == 404


def test_only_images_and_only_the_owner(monkeypatch):
    files, txs = {}, FakeTransactions()
    assert make("A", monkeypatch, files, txs).put("/api/transactions/tx/attachment", json={"data_url": "data:text/html;base64," + "A" * 64}).status_code == 422
    assert make("B", monkeypatch, files, txs).put("/api/transactions/tx/attachment", json={"data_url": IMG}).status_code == 404
    assert "B" not in files or not files["B"]
