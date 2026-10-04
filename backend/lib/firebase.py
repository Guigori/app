"""Firebase Admin initialization for FINNOS.

Credentials are environment-only. No service-account JSON is committed.
Supports FIREBASE_PRIVATE_KEY with escaped newlines, which is convenient for
Vercel/managed hosts.
"""
import os
import firebase_admin
from firebase_admin import auth as firebase_auth, credentials, firestore

def _credential():
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
        return firebase_admin.initialize_app(options={"projectId": os.getenv("FIREBASE_PROJECT_ID", "finnos-app")})

def get_firestore():
    return firestore.client(app=get_firebase_app())

def verify_id_token(token: str) -> dict:
    return firebase_auth.verify_id_token(token, app=get_firebase_app(), check_revoked=True)
