"""Contract tests for Firebase bearer dependency (no live credentials needed)."""
import pytest
from fastapi import HTTPException
from unittest.mock import patch

from lib.firebase_auth import firebase_identity, require_verified_firebase_user


class FakeRequest:
    def __init__(self, authorization=None):
        self.headers = {} if authorization is None else {"authorization": authorization}


def test_missing_bearer_rejected():
    with pytest.raises(HTTPException) as err:
        firebase_identity(FakeRequest())
    assert err.value.status_code == 401


def test_malformed_scheme_rejected():
    with pytest.raises(HTTPException) as err:
        firebase_identity(FakeRequest("Basic abc"))
    assert err.value.status_code == 401


def test_verified_token_maps_uid():
    with patch("lib.firebase_auth.verify_id_token", return_value={
        "uid": "firebase-user-1", "email": "test@example.com", "email_verified": True
    }) as verify:
        user = firebase_identity(FakeRequest("Bearer signed-token"))
    verify.assert_called_once_with("signed-token")
    assert user["id"] == "firebase-user-1"
    assert require_verified_firebase_user(user) == user


def test_missing_uid_rejected():
    with patch("lib.firebase_auth.verify_id_token", return_value={"email_verified": True}):
        with pytest.raises(HTTPException) as err:
            firebase_identity(FakeRequest("Bearer signed-token"))
    assert err.value.status_code == 401


def test_unverified_email_rejected():
    with pytest.raises(HTTPException) as err:
        require_verified_firebase_user({"uid": "a", "email_verified": False})
    assert err.value.status_code == 403
