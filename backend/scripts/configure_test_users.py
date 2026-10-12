"""Link email/password to the approved synthetic UIDs in finnos-app.

No financial documents are written, no personal user is changed, and no user
is recreated or deleted. Password input is hidden; generate/save in Apple Passwords.
"""
import argparse
import getpass
import hashlib
import json
import sys
import warnings
from pathlib import Path
from firebase_admin import initialize_app, credentials, auth, firestore

RUN = 'b68274e7-369c-4957-bed9-1958ae98dbb2'
USERS = {x: (f'finnos-preview-{RUN}-{x.lower()}', f'teste.{x.lower()}@finnos.test') for x in 'ABC'}


def inventory(app):
    if app.project_id != 'finnos-app': raise ValueError('Wrong Authentication project')
    db = firestore.client(app=app)
    if db.project != 'finnos-app': raise ValueError('Only the authorized project is allowed')
    result = {}
    for label, (uid, email) in USERS.items():
        user = auth.get_user(uid, app=app)
        if (user.email not in {email, f'teste-{label.lower()}-{RUN}@finnos-preview.invalid'}
                or not (user.display_name or '').startswith('Teste-')):
            raise ValueError('Identity is not the approved synthetic user')
        try:
            collision = auth.get_user_by_email(email, app=app)
            if collision.uid != uid: raise ValueError('Email belongs to another UID; no identities will be changed')
        except auth.UserNotFoundError: pass
        owner = db.collection('users').document(uid)
        docs = {}
        def visit(ref):
            row = ref.get()
            if row.exists: docs[ref.path] = row.to_dict()
            for collection in ref.collections():
                for child in collection.list_documents(): visit(child)
        visit(owner)
        digest = hashlib.sha256(json.dumps(docs, default=str, sort_keys=True).encode()).hexdigest()
        result[label] = {'hash': digest, 'count': len(docs)}
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--credential', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    raw = json.loads(Path(args.credential).read_bytes())
    if raw.get('project_id') != 'finnos-app': raise ValueError('Wrong credential project')
    app = initialize_app(credentials.Certificate(raw), name='approved-test-identities')
    before = inventory(app)  # Preflight all three identities before changing any one.
    print(json.dumps({'mode': 'inspection', 'counts': {x:y['count'] for x,y in before.items()}, 'uids_preserved': True}))
    if not args.execute: return
    if not sys.stdin.isatty():
        raise ValueError('Password configuration requires an interactive terminal with hidden input')
    passwords = {}
    password = None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            for label in USERS:
                password = getpass.getpass(f'Senha de {label}, gerada e salva no app Senhas: ')
                if len(password) < 20 or password in passwords.values():
                    raise ValueError('Use distinct strong passwords with at least 20 characters')
                passwords[label] = password
        password = None
        # Recheck all identities and financial content after the operator's input.
        if inventory(app) != before:
            raise ValueError('Records changed during preflight; no identities will be changed')
        for label, (uid, email) in USERS.items():
            auth.update_user(uid, email=email, password=passwords.pop(label), email_verified=True, app=app)
            current = auth.get_user(uid, app=app)
            if current.uid != uid or current.email != email: raise ValueError('Identity verification failed')
        after = inventory(app)
        if after != before: raise ValueError('Financial records changed; inspect without overwriting')
        print(json.dumps({'updated': list(USERS), 'uids_preserved': True, 'financial_hashes_unchanged': True}))
    finally:
        passwords.clear()
        password = None


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Operação interrompida. Nenhum detalhe sensível foi exibido; confira o estado dos três usuários antes de repetir.')
