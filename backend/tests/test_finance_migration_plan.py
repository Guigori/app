import copy
import importlib.util
from pathlib import Path
import pytest
spec=importlib.util.spec_from_file_location('migration',Path(__file__).parents[1]/'scripts/finance_migration_plan.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def sample():
    return {'users':[dict(id='legacy-a',email='synthetic@example.invalid',password_hash='do-not-copy')],'accounts':[dict(id='bank',user_id='legacy-a',initial_balance=100.11)],'transactions':[dict(id='tx',user_id='legacy-a',account_id='bank',value=33.33,date='2026-10-12')]},[dict(legacy_user_id='legacy-a',firebase_uid='firebase-a',evidence='Synthetic fixture owner attestation',verified_by='fixture',approved=True)]


def test_plan_exact_money_identity_relations_and_idempotence():
    source,mapping=sample();original=copy.deepcopy(source)
    plan=m.prepare(source,mapping)
    assert source==original and m.prepare(source,mapping)==plan
    docs={d['path']:d['document'] for d in plan['documents']}
    assert docs['users/firebase-a/accounts/bank']['initial_balance_cents']==10011
    assert docs['users/firebase-a/transactions/tx']['value_cents']==3333
    assert 'password_hash' not in str(plan)
    assert docs['users/firebase-a/transactions/tx']['account_id']=='bank'


def test_unverified_owner_foreign_reference_and_precision_fail_closed():
    source,mapping=sample()
    with pytest.raises(ValueError):m.prepare(source,[])
    source['transactions'][0]['account_id']='foreign'
    with pytest.raises(ValueError):m.prepare(source,mapping)
    source['transactions'][0]['account_id']='bank';source['transactions'][0]['value']=0.001
    with pytest.raises(ValueError):m.prepare(source,mapping)


def test_isolated_rehearsal_twice_and_compare_without_source_changes():
    from types import SimpleNamespace
    store={}
    class Ref:
        def __init__(self,path):self.path=path
        def get(self):return SimpleNamespace(exists=self.path in store,to_dict=lambda:copy.deepcopy(store.get(self.path)))
        def create(self,doc):store[self.path]=copy.deepcopy(doc)
    db=SimpleNamespace(project='finnos-dev',document=Ref)
    source,mapping=sample();plan=m.prepare(source,mapping)
    assert m.rehearsal(plan,db,'fixture')['verified_documents']==3
    assert m.rehearsal(plan,db,'fixture')['verified_documents']==3
    assert all(p.startswith('migration_runs/fixture/') for p in store)
    store[next(iter(store))]['name']='divergent'
    with pytest.raises(ValueError):m.rehearsal(plan,db,'fixture')
    db.project='finnos-app'
    with pytest.raises(ValueError):m.rehearsal(plan,db,'fixture')
