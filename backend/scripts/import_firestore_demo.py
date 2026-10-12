"""Non-destructive, atomic, UID-scoped import of the unchanged FINNOS demo source.

Default is inspection. Existing financial records must exactly match the encrypted
approved synthetic baseline; unknown/real records block import. A manifest prevents
re-import after later edits and preserves the original month. No Auth writes.
"""
import argparse
import ast
import calendar
import hashlib
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'frontend'))
from finnos.lib.db import encode
from finnos.lib.money import D
from finnos.lib.stats import add_months
from backup_firebase_users import OWNER, TESTS, recover, typed
from firebase_admin import auth, credentials, initialize_app, firestore

VERSION = 'finnos-demo-v1'
SOURCE = Path(__file__).resolve().parents[1] / 'lib' / 'demo_data.py'
COLLECTIONS = ('accounts', 'categories', 'cards', 'transactions')


def identifier(uid, collection, key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'{VERSION}/{uid}/{collection}/{key}'))


def build(uid, anchor):
    """Read only literal data and pure demo functions; never import legacy Mongo."""
    tree = ast.parse(SOURCE.read_text())
    names = {'DEFAULT_CATEGORIES', 'DEMO_ACCOUNTS', 'DEMO_CARDS'}
    selected = [n for n in tree.body if
                isinstance(n, (ast.Assign, ast.AnnAssign)) and
                any(isinstance(t, ast.Name) and t.id in names for t in
                    (n.targets if isinstance(n, ast.Assign) else [n.target])) or
                isinstance(n, ast.FunctionDef) and n.name in {'_day', 'demo_transactions'}]
    context = dict(calendar=calendar, uuid=uuid, datetime=datetime,
                   today_date=lambda: anchor.date(), add_months=add_months)
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), 'exec'), context)
    out = {name: {} for name in COLLECTIONS}
    metadata = dict(user_id=uid, demo=True, demo_import=VERSION,
                    demo_source='backend/lib/demo_data.py', demo_month=anchor.strftime('%Y-%m'),
                    created_at=anchor, updated_at=anchor)
    def put(col, key, doc):
        rid = identifier(uid, col, key)
        out[col][rid] = encode(dict(doc, **metadata, id=rid))
        return rid
    cats = {row['name']: put('categories', row['name'], dict(row)) for row in context['DEFAULT_CATEGORIES']}
    accounts = {row['name']: put('accounts', row['name'], dict(row, active=True)) for row in context['DEMO_ACCOUNTS']}
    cards = {}
    for row in context['DEMO_CARDS']:
        doc = dict(row)
        doc['payment_account_id'] = accounts[doc.pop('account_name')]
        cards[row['name']] = put('cards', row['name'], doc)
    for index, row in enumerate(context['demo_transactions'](anchor)):
        doc = dict(row)
        for key in ('id', 'created_at', 'updated_at'): doc.pop(key, None)
        doc['account_id'] = accounts[doc.pop('account_key')]
        doc['to_account_id'] = accounts.get(doc.pop('to_account_key', None))
        doc['card_id'] = cards.get(doc.pop('card_key', None))
        doc['category_id'] = cats.get(doc.pop('category_key', None))
        if doc.get('installment'):
            # Original backend fixture incorrectly used the monthly amount as total.
            doc['value'] = D(doc['installment_value']) * doc['total_installments']
            doc['demo_adjustment'] = 'purchase_total_equals_sum_of_installments'
        doc.setdefault('fixed', False)
        doc.setdefault('installment', False)
        doc.setdefault('recurrence', None)
        doc['version'] = 1
        put('transactions', f'{index}:{doc["name"]}', doc)
    return out


def canonical(value):
    return json.dumps(value, default=typed, sort_keys=True, separators=(',', ':'))


def validate_existing(uid, records, approved_baseline):
    for col, rows in records.items():
        for rid, doc in rows.items():
            path = f'users/{uid}/{col}/{rid}'
            expected = approved_baseline.get(path)
            if uid == OWNER or expected is None or canonical(doc) != canonical(expected):
                raise ValueError('Existing or changed financial data blocks import; no records were replaced')


def import_user(client, uid, anchor, baseline, execute=False):
    root = client.collection('users').document(uid)
    @firestore.transactional
    def run(tx):
        manifest_ref = root.collection('_meta').document(VERSION)
        manifest = manifest_ref.get(transaction=tx)
        revision_ref = root.collection('_meta').document('finance')
        revision = revision_ref.get(transaction=tx)
        if manifest.exists:
            return {'status': 'already_imported', 'counts': manifest.to_dict()['counts'], 'writes': 0}
        records = {}
        for collection in root.collections():
            if collection.id.startswith('_'): continue
            # Any other user subcollection could contain real financial data.
            rows = {s.id: s.to_dict() for s in collection.stream(transaction=tx)}
            if rows: records[collection.id] = rows
        validate_existing(uid, records, baseline)
        dataset = build(uid, anchor)
        counts = {col:len(rows) for col, rows in dataset.items()}
        if execute:
            for col, rows in dataset.items():
                for rid, doc in rows.items(): tx.create(root.collection(col).document(rid), doc)
            tx.create(manifest_ref, dict(version=VERSION, counts=counts, uid=uid,
                        anchor=anchor.isoformat(), source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                        financial_writes=sum(counts.values()), existing_preserved=sum(len(v) for v in records.values())))
            tx.set(revision_ref, {'revision': (revision.to_dict() or {}).get('revision', 0)+1})
        return {'status':'imported' if execute else 'inspection', 'counts':counts,
                'existing_preserved':sum(len(v) for v in records.values()),
                'writes':sum(counts.values())+2 if execute else 0}
    return run(client.transaction())


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--credential', required=True)
    p.add_argument('--baseline', required=True, help='Encrypted approved synthetic baseline')
    p.add_argument('--execute', action='store_true')
    args = p.parse_args()
    raw = json.loads(Path(args.credential).read_bytes())
    if raw.get('project_id') != 'finnos-app': raise ValueError('Wrong project')
    baseline = json.loads(recover(raw, json.loads(Path(args.baseline).read_bytes())))
    app = initialize_app(credentials.Certificate(raw), name='explicit-demo-import')
    client = firestore.client(app=app)
    if client.project != 'finnos-app': raise ValueError('Wrong Firestore project')
    uids = [OWNER, *TESTS]
    for index, uid in enumerate(uids):
        user = auth.get_user(uid, app=app)
        if not user.email_verified or user.disabled: raise ValueError('Unavailable identity')
        if index and user.email != f'teste.{"abc"[index-1]}@finnos.test': raise ValueError('Wrong test identity')
        if not index and 'google.com' not in [x.provider_id for x in user.provider_data]: raise ValueError('Owner identity changed')
    anchor = datetime.now(timezone.utc)
    # Validate every profile before starting any write; revalidate inside each transaction.
    for uid in uids: import_user(client, uid, anchor, baseline)
    for label, uid in zip(('Founder','A','B','C'), uids):
        print(json.dumps(dict(profile=label, **import_user(client, uid, anchor, baseline, args.execute))))


if __name__ == '__main__': main()
