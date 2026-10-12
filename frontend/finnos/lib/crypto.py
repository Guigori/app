"""Environment-scoped encrypted provider credentials; never returned in plaintext."""
import os
from cryptography.fernet import Fernet, InvalidToken

def configured():
    try: Fernet(os.environ['FERNET_KEY'].encode()); return True
    except (KeyError, ValueError): return False

def cipher():
    if not configured(): raise ValueError('Encryption unavailable')
    return Fernet(os.environ['FERNET_KEY'].encode())

def encrypt_secret(raw): return cipher().encrypt(raw.encode()).decode()
def decrypt_secret(value):
    try: return cipher().decrypt(value.encode()).decode()
    except InvalidToken as exc: raise ValueError('Invalid stored key') from exc

def mask_secret(raw): return '••••'+raw[-4:] if len(raw)>=8 else '••••'
