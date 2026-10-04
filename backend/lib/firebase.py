"""Firebase Admin initialization for FINNOS.

Credentials are environment-only. No service-account JSON is committed.
The preferred production configuration is FIREBASE_SERVICE_ACCOUNT_JSON,
stored as a secret in the deployment environment.
"""
import json
import os

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials, firestore


def _credential():
    service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if service_account_json:
        try:
            payload = json.loads(service_account_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON") from exc
        return credentials.Certificate(payload)

    # Backward-compatible split variables for local/legacy environments.
    project_id = os.getenv("FIREBASE_PROJECT_ID")
    client_email = os.getenv("FIREBASE_CLIENT_EMAIL")
    private_key = os.getenv("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
    if project_id and client_email and private_key:
        return credentials.Certificate({
            "type": "service_account",
            "project_id": project_id,
            "client_email": client_email,
            "private_key": private_key,
            "token_uri": "https://oauth2.googleapis.com/token",
        })
    return None


def get_firebase_app():
    try:
        return firebase_admin.get_app()
    except ValueError:
        cred = _credential()
        if cred:
            return firebase_admin.initialize_app(cred)
        return firebase_admin.initialize_app(
            options={"projectId": os.getenv("FIREBASE_PROJECT_ID", "finnos-app")}
        )


def get_firestore():
    return firestore.client(app=get_firebase_app())


def verify_id_token(token: str) -> dict:
    return firebase_auth.verify_id_token(
        token, app=get_firebase_app(), check_revoked=True
    )
