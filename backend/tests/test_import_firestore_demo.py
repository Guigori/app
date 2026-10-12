import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parents[1]/'scripts'))
spec = importlib.util.spec_from_file_location('demo_import', Path(__file__).parents[1]/'scripts'/'import_firestore_demo.py')
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)


def test_deterministic_isolated_references_and_exact_installments():
    anchor = datetime(2026,10,12,tzinfo=timezone.utc)
    a = demo.build(demo.TESTS[0],anchor)
    assert a == demo.build(demo.TESTS[0],anchor)
    b = demo.build(demo.TESTS[1],anchor)
    assert {k:len(v) for k,v in a.items()} == dict(accounts=4,categories=15,cards=2,transactions=30)
    assert not set(a['accounts']) & set(b['accounts'])
    for row in a['transactions'].values():
        assert row['demo'] is True and row['user_id']==demo.TESTS[0]
        assert row['account_id'] in a['accounts']
        assert not row['to_account_id'] or row['to_account_id'] in a['accounts']
        assert not row['category_id'] or row['category_id'] in a['categories']
        assert not row['card_id'] or row['card_id'] in a['cards']
        assert isinstance(row['value_cents'],int)
    for card in a['cards'].values(): assert card['payment_account_id'] in a['accounts']
    mac = next(t for t in a['transactions'].values() if t['name']=='MacBook')
    assert mac['value_cents']==600000 and mac['installment_value_cents']==60000
    assert mac['value_cents']==mac['total_installments']*mac['installment_value_cents']


def test_unknown_or_modified_records_block_import_and_owner_is_empty_only():
    uid=demo.TESTS[0]
    row={'name':'Teste A · Banco','initial_balance_cents':100}
    baseline={f'users/{uid}/accounts/known':row}
    demo.validate_existing(uid, {'accounts':{'known':row}},baseline)
    with pytest.raises(ValueError): demo.validate_existing(uid, {'accounts':{'foreign':row}},baseline)
    with pytest.raises(ValueError): demo.validate_existing(uid, {'accounts':{'known':dict(row,initial_balance_cents=101)}},baseline)
    with pytest.raises(ValueError): demo.validate_existing(demo.OWNER, {'accounts':{'known':row}},baseline)
    demo.validate_existing(demo.OWNER,{},baseline)


def test_manifest_reexecution_returns_without_writes(monkeypatch):
    from types import SimpleNamespace
    counts={'accounts':4,'categories':15,'cards':2,'transactions':30}
    class Ref:
        def collection(self,name): return self
        def document(self,name): self.name=name; return self
        def get(self,transaction):
            return SimpleNamespace(exists=self.name==demo.VERSION,
                to_dict=lambda: {'counts':counts} if self.name==demo.VERSION else {'revision':1})
        def collections(self): raise AssertionError('Already imported data must not be recreated')
    # Separate refs preserve the saved manifest snapshot in this fake.
    class Root:
        def collection(self,name): return Ref()
    class Client:
        def collection(self,name): return SimpleNamespace(document=lambda uid:Root())
        def transaction(self): return object()
    monkeypatch.setattr(demo.firestore,'transactional',lambda fn:fn)
    assert demo.import_user(Client(),demo.TESTS[0],datetime.now(timezone.utc),{},True)==dict(status='already_imported',counts=counts,writes=0)
