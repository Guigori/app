"""Unit tests for Firebase namespace financial reference checks."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from lib import firestore_refcheck


class Collection:
    def __init__(self, records, path=""):
        self.records = records
        self.path = path

    def document(self, key):
        path = self.path + "/" + key
        return Collection(self.records, path)

    def collection(self, key):
        return Collection(self.records, self.path + "/" + key)

    def get(self):
        return SimpleNamespace(exists=self.path in self.records)


def payload(**changes):
    defaults = dict(account_id="a", to_account_id=None, category_id="c", card_id=None, type="despesa")
    return SimpleNamespace(**(defaults | changes))


def test_references_scoped_to_verified_uid(monkeypatch):
    records = {"/users/alice/accounts/a", "/users/alice/categories/c", "/users/bob/cards/b"}
    monkeypatch.setattr(firestore_refcheck, "get_firestore", lambda: Collection(records))
    firestore_refcheck.validate("alice", payload())
    with pytest.raises(HTTPException) as exc:
        firestore_refcheck.validate("alice", payload(card_id="b"))
    assert exc.value.status_code == 400


def test_transfer_requires_two_owned_accounts(monkeypatch):
    records = {"/users/alice/accounts/a", "/users/alice/accounts/b"}
    monkeypatch.setattr(firestore_refcheck, "get_firestore", lambda: Collection(records))
    with pytest.raises(HTTPException):
        firestore_refcheck.validate("alice", payload(type="transferencia", category_id=None, to_account_id="a"))
    firestore_refcheck.validate("alice", payload(type="transferencia", category_id=None, to_account_id="b"))
