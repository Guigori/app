"""Encrypted read-only backup of the confirmed owner and three approved test UIDs.

The existing service account's public key wraps an ephemeral encryption key.
Recovery requires that same private key. No Firestore restore/write is performed.
"""
import argparse
import base64
import hashlib
import json
import os
from datetime import datetime, date
from pathlib import Path
from firebase_admin import credentials, initialize_app, firestore
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

OWNER = '7VrKbP0TXsMsIOFt4knFJasDzr13'
TESTS = [f'finnos-preview-b68274e7-369c-4957-bed9-1958ae98dbb2-{x}' for x in 'abc']
AAD = b'FINNOS:finnos-app:approved-user-backup:v1'


def typed(value):
    if isinstance(value, (datetime, date)): return {'__timestamp__': value.isoformat()}
    if isinstance(value, bytes): return {'__bytes__': base64.b64encode(value).decode()}
    if hasattr(value, 'path'): return {'__reference__': value.path}
    if hasattr(value, 'latitude') and hasattr(value, 'longitude'):
        return {'__geopoint__': [value.latitude, value.longitude]}
    raise TypeError('Unsupported Firestore type; no incomplete backup is allowed')


def capture(client):
    result = {}
    def visit(ref):
        row = ref.get()
        if row.exists: result[ref.path] = row.to_dict()
        for collection in ref.collections():
            for child in collection.list_documents(): visit(child)
    for uid in [OWNER, *TESTS]: visit(client.collection('users').document(uid))
    return json.dumps(result, default=typed, sort_keys=True, separators=(',', ':')).encode()


def recover(raw, envelope):
    if envelope.get('project') != 'finnos-app' or envelope.get('format') != 1:
        raise ValueError('Unexpected backup project or format')
    private = serialization.load_pem_private_key(raw['private_key'].encode(), password=None)
    key = private.decrypt(base64.b64decode(envelope['wrapped_key']), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    return AESGCM(key).decrypt(base64.b64decode(envelope['nonce']), base64.b64decode(envelope['ciphertext']), AAD)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--credential', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--verify-existing', action='store_true')
    args = parser.parse_args()
    raw = json.loads(Path(args.credential).read_bytes())
    if raw.get('project_id') != 'finnos-app': raise ValueError('Wrong project')
    if args.verify_existing:
        recovered = recover(raw, json.loads(Path(args.output).read_bytes()))
        print(json.dumps({'authenticated_recovery': True, 'documents': len(json.loads(recovered)), 'firestore_writes': 0}))
        return
    app = initialize_app(credentials.Certificate(raw), name='approved-owner-backup')
    db = firestore.client(app=app)
    first = capture(db)
    if capture(db) != first: raise ValueError('Records changed during capture; retry without overwriting')
    private = serialization.load_pem_private_key(raw['private_key'].encode(), password=None)
    symmetric, nonce = os.urandom(32), os.urandom(12)
    wrapped = private.public_key().encrypt(symmetric, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    ciphertext = AESGCM(symmetric).encrypt(nonce, first, AAD)
    envelope = {'format': 1, 'project': 'finnos-app', 'key_id': raw['private_key_id'],
                'wrapped_key': base64.b64encode(wrapped).decode(), 'nonce': base64.b64encode(nonce).decode(),
                'ciphertext': base64.b64encode(ciphertext).decode()}
    path = Path(args.output)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as target: target.write(json.dumps(envelope).encode())
    saved = json.loads(path.read_bytes())
    recovered = recover(raw, saved)
    if recovered != first: raise ValueError('Encrypted recovery verification failed')
    docs = json.loads(recovered)
    print(json.dumps({'project': 'finnos-app', 'documents': len(docs), 'encrypted': True,
                      'byte_recovery_verified': True, 'firestore_writes': 0,
                      'archive_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}))


if __name__ == '__main__': main()
