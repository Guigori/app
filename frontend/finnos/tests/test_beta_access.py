"""Beta access: waitlist, invite gate, feedback, error reports and admin. In-memory Firestore double."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from finnos.routers import access


class Snap:
    def __init__(self, key, value):
        self.id = key
        self.exists = value is not None
        self._value = value

    def to_dict(self):
        return dict(self._value) if self._value else None


class Ref:
    def __init__(self, store, path):
        self.store, self.path = store, path
        self.id = path[-1]

    def get(self):
        return Snap(self.id, self.store.get(self.path))

    def set(self, data, merge=False):
        data = {k: (getattr(self.store.get(self.path, {}), "get", lambda *_: 0)(k, 0) + 1 if type(v).__name__ == "Increment" else v)
                for k, v in data.items()}
        self.store[self.path] = {**self.store.get(self.path, {}), **data} if merge else data

    def delete(self):
        self.store.pop(self.path, None)

    def collection(self, name):
        return Col(self.store, self.path + (name,))


class Col:
    def __init__(self, store, path):
        self.store, self.path, self.max = store, path, 1000

    def document(self, key):
        return Ref(self.store, self.path + (key,))

    def add(self, data):
        key = f"id{len(self.store)}"
        self.document(key).set(data)
        return None, SimpleNamespace(id=key)

    def limit(self, n):
        self.max = n
        return self

    def order_by(self, *_a, **_k):
        return self

    def stream(self):
        return [Snap(k[-1], v) for k, v in self.store.items() if k[:-1] == self.path][: self.max]


class FakeDb:
    def __init__(self):
        self.store = {}

    def collection(self, name):
        return Col(self.store, (name,))


@pytest.fixture
def fake(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(access, "_db", lambda: db)
    monkeypatch.setattr(access.store, "root", lambda client, uid: client.collection("users").document(uid))
    monkeypatch.setattr(access, "run_in_threadpool", lambda fn: asyncio.sleep(0, result=fn()))
    access._hits.clear()
    access.forget()
    return db


def request(ip="1.1.1.1"):
    return SimpleNamespace(headers={"x-forwarded-for": ip}, client=None)


def join(**over):
    data = {"name": "Ana  Souza", "phone": "(11) 98888-7777", "email": " Ana@Mail.com ", "consent": True}
    return access.join_waitlist(access.WaitlistIn(**{**data, **over}), request())


def test_waitlist_stores_once_per_email_and_rejects_bad_input(fake):
    assert asyncio.run(join())["created"] is True
    assert asyncio.run(join(name="Ana S"))["created"] is False
    rows = [v for k, v in fake.store.items() if k[0] == access.WAITLIST]
    assert len(rows) == 1 and rows[0]["email"] == "ana@mail.com" and rows[0]["phone"] == "11988887777"
    assert rows[0]["status"] == "novo" and rows[0]["name"] == "Ana S"
    for bad in ({"consent": False}, {"email": "ana@mail"}, {"phone": "12345678"}):
        with pytest.raises(HTTPException) as error:
            asyncio.run(join(**bad))
        assert error.value.status_code == 422


def test_honeypot_stores_nothing_and_rate_limit(fake):
    assert asyncio.run(join(website="spam.com"))["ok"] is True
    assert fake.store == {}
    for i in range(3):
        asyncio.run(join(email=f"p{i}@mail.com"))
    with pytest.raises(HTTPException) as error:
        for i in range(5):
            asyncio.run(join(email=f"q{i}@mail.com"))
    assert error.value.status_code == 429


def test_gate_is_off_by_default(fake, monkeypatch):
    monkeypatch.delenv("FINNOS_INVITE_ONLY", raising=False)
    access.check_access("new", "new@mail.com")


def test_gate_lets_in_admins_invited_and_existing_users(fake, monkeypatch):
    monkeypatch.setenv("FINNOS_INVITE_ONLY", "1")
    monkeypatch.setenv("ADMIN_EMAILS", "Dono@Mail.com, outro@mail.com")
    access.check_access("boss", "dono@mail.com")
    with pytest.raises(HTTPException) as error:
        access.check_access("new", "new@mail.com")
    assert error.value.status_code == 403 and error.value.detail == "convite"
    fake.collection("users").document("old").collection("accounts").document("a1").set({"name": "Nubank"})
    access.check_access("old", "old@mail.com")
    admin = {"id": "boss", "email": "dono@mail.com"}
    asyncio.run(access.grant_access(access.InviteIn(email="NEW@mail.com"), admin))
    access.check_access("new", "new@mail.com")
    asyncio.run(access.revoke_access(access.email_key("new@mail.com"), admin))
    with pytest.raises(HTTPException):
        access.check_access("new", "new@mail.com")


def test_invite_marks_waitlist_and_admin_only(fake, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "dono@mail.com")
    asyncio.run(join())
    asyncio.run(access.grant_access(access.InviteIn(email="ana@mail.com"), {"id": "b", "email": "dono@mail.com"}))
    assert fake.store[(access.WAITLIST, access.email_key("ana@mail.com"))]["status"] == "liberado"
    assert fake.store[(access.ACCESS, access.email_key("ana@mail.com"))]["name"] == "Ana Souza"
    with pytest.raises(HTTPException) as error:
        asyncio.run(access.require_admin({"id": "x", "email": "ana@mail.com"}))
    assert error.value.status_code == 404
    overview = asyncio.run(access.admin_overview({"id": "b", "email": "dono@mail.com"}))
    assert len(overview["waitlist"]) == 1 and len(overview["access"]) == 1


def test_feedback_and_errors_are_grouped(fake):
    me = {"id": "u1", "email": "u1@mail.com"}
    asyncio.run(access.send_feedback(access.FeedbackIn(kind="bug", message="Botão não salva", screen="/fluxo?x=1"), me))
    feedback = [v for k, v in fake.store.items() if k[0] == access.FEEDBACK]
    assert feedback[0]["screen"] == "/fluxo" and feedback[0]["email"] == "u1@mail.com"
    stack = "TypeError: x\n    at render (https://app/assets/index-abc.js:10:20)"
    for line in (1, 2):
        asyncio.run(access.report_error(access.ClientErrorIn(message=f"Cannot read id of {line}", stack=stack), me))
    asyncio.run(access.report_error(access.ClientErrorIn(message="Cannot read id of 3", stack=stack), {"id": "u2", "email": "u2@m.com"}))
    errors = [v for k, v in fake.store.items() if k[0] == access.ERRORS]
    assert len(errors) == 1 and errors[0]["count"] == 3 and errors[0]["user_count"] == 2
