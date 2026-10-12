"""Preserve the three existing synthetic UIDs while copying to finnos-dev only.

Requires source and target Admin credential FILE paths in environment. Never
prints credentials or user documents. Source is read-only; no production writes.
Passwords must be supplied interactively from the owner's password manager.
No user is deleted. Run without --execute first to check counts and references.
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
from firebase_admin import initialize_app, credentials, auth, firestore

RUN='b68274e7-369c-4957-bed9-1958ae98dbb2'
USERS={label:(f'finnos-preview-{RUN}-{label.lower()}',f'teste.{label.lower()}@finnos.test') for label in 'ABC'}
RESOURCES=('accounts','categories','transactions','cards','budget_cycles','goals','radar_states','radar_feedback')


def check_project(path,expected,name):
    raw=json.loads(Path(path).read_text())
    if raw.get('project_id')!=expected:raise ValueError('Wrong credential project')
    return initialize_app(credentials.Certificate(raw),name=name)


def hash_doc(doc):return hashlib.sha256(json.dumps(doc,default=str,sort_keys=True).encode()).hexdigest()


def inspect(source_app):
    source=firestore.client(app=source_app)
    result={}
    for label,(uid,email) in USERS.items():
        user=auth.get_user(uid,app=source_app)
        if not user.email.endswith('@finnos-preview.invalid') or not user.display_name.startswith('Teste-'):raise ValueError('Source is not approved synthetic identity')
        owner=source.collection('users').document(uid)
        rows={name:{doc.id:doc.to_dict() for doc in owner.collection(name).stream()} for name in RESOURCES}
        for identifier,tx in rows['transactions'].items():
            for field,target in [('account_id','accounts'),('to_account_id','accounts'),('card_id','cards'),('category_id','categories')]:
                if tx.get(field) and tx[field] not in rows[target]:raise ValueError('Invalid synthetic relationship')
        result[label]=rows
    return result


def execute(data,target_app):
    target=firestore.client(app=target_app)
    if target.project!='finnos-dev':raise ValueError('Target must be finnos-dev')
    passwords=set()
    for label,(uid,email) in USERS.items():
        password=getpass.getpass(f'Senha forte de teste {label} (use o app Senhas; não fica em arquivo): ')
        if len(password)<20 or password in passwords:raise ValueError('Use distinct strong passwords of at least 20 characters')
        passwords.add(password)
        try:
            current=auth.get_user(uid,app=target_app)
            if current.email!=email:raise ValueError('Existing UID identity differs; never overwrite')
            auth.update_user(uid,password=password,email_verified=True,app=target_app)
        except auth.UserNotFoundError:
            auth.create_user(uid=uid,email=email,password=password,email_verified=True,display_name=f'Teste-{label} FINNOS',app=target_app)
        for name,docs in data[label].items():
            for identifier,doc in docs.items():
                ref=target.collection('users').document(uid).collection(name).document(identifier)
                previous=ref.get()
                if previous.exists:
                    if hash_doc(previous.to_dict())!=hash_doc(doc):raise ValueError('Target differs; stopped without overwriting financial data')
                else:ref.create(doc)
        for name,docs in data[label].items():
            for identifier,doc in docs.items():
                result=target.collection('users').document(uid).collection(name).document(identifier).get()
                if not result.exists or hash_doc(result.to_dict())!=hash_doc(doc):raise ValueError('Read-back mismatch')
        print(json.dumps({'label':label,'copied_counts':{name:len(docs) for name,docs in data[label].items()},'uid_preserved':auth.get_user(uid,app=target_app).uid==uid,'verified':True}))
    passwords.clear()


def main():
    raise SystemExit("Deprecated: finnos-dev is inactive. Use configure_test_users.py to preserve identities in finnos-app.")
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    source=check_project(os.environ['FINNOS_SOURCE_ADMIN_FILE'],'finnos-app','test-source-readonly')
    data=inspect(source)
    print(json.dumps({'mode':'dry-run','counts':{label:{name:len(docs) for name,docs in rows.items()} for label,rows in data.items()}}))
    if args.execute:
        target=check_project(os.environ['FINNOS_DEV_ADMIN_FILE'],'finnos-dev','test-target')
        execute(data,target)

if __name__=='__main__':main()
