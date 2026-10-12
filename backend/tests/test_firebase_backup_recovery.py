import base64
import importlib.util
from pathlib import Path
import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

spec = importlib.util.spec_from_file_location('firebase_backup', Path(__file__).parents[1]/'scripts'/'backup_firebase_users.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def test_authenticated_recovery_rejects_corruption_and_foreign_key():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    raw = {'private_key':private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()}
    key, nonce = b'k'*32, b'n'*12
    expected = b'{"users/test/accounts/bank":{"initial_balance_cents":12345}}'
    ciphertext = AESGCM(key).encrypt(nonce, expected, backup.AAD)
    wrapped = private.public_key().encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    archive = dict(format=1, project='finnos-app', wrapped_key=base64.b64encode(wrapped).decode(), nonce=base64.b64encode(nonce).decode(), ciphertext=base64.b64encode(ciphertext).decode())
    assert backup.recover(raw, archive) == expected
    with pytest.raises(InvalidTag):
        backup.recover(raw, {**archive, 'ciphertext':base64.b64encode(ciphertext[:-1]+bytes([ciphertext[-1]^1])).decode()})
    with pytest.raises(ValueError): backup.recover(raw, {**archive, 'project':'foreign'})
    foreign = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    foreign_raw = {'private_key':foreign.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode()}
    with pytest.raises(ValueError): backup.recover(foreign_raw, archive)
