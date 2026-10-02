"""Field-level encryption for per-user third-party API keys.

Keys are decrypted only in the request that calls the provider; they are never
returned to the frontend (only a masked form) and never logged.
"""

from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

load_dotenv()

_fernet = Fernet(os.environ["FERNET_KEY"].encode())


def encrypt_secret(raw: str) -> str:
    return _fernet.encrypt(raw.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet.decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:  # key rotated or tampered payload
        raise ValueError("stored key could not be decrypted") from exc


def mask_secret(raw: str) -> str:
    return (raw[:3] + "•••" + raw[-4:]) if len(raw) >= 8 else "•••"
