"""Firestore CRUD contract tests: no live Firebase credentials required."""
from unittest.mock import patch
from decimal import Decimal
import pytest
from fastapi import HTTPException
from models.finnos import TransactionIn
from routers.firebase_transactions import _collection, _to_doc, _public

def sample():
    return TransactionIn(name="Teste", value=10.25, type="despesa",
                         date="2026-10-12", account_id="account-1")

def test_money_stored_as_integer_cents():
    doc = _to_doc(sample(), "tx-1")
    assert doc["value_cents"] == 1025
    assert "value" not in doc
    assert _public(doc)["value"] == 10.25

def test_rounding_is_decimal_not_float():
    doc = _to_doc(sample().model_copy(update={"value": 1.005}), "tx-1")
    assert doc["value_cents"] == 101

def test_uid_scopes_firestore_collection():
    with patch("routers.firebase_transactions.get_firestore") as firestore:
        _collection("uid-A")
        firestore.return_value.collection.assert_called_once_with("users")
        firestore.return_value.collection.return_value.document.assert_called_once_with("uid-A")
        firestore.return_value.collection.return_value.document.return_value.collection.assert_called_once_with("transactions")

def test_no_client_supplied_uid_in_transaction_document():
    assert "user_id" not in _to_doc(sample(), "tx-1")
