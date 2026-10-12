import importlib.util
import json
import sys
import warnings
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import pytest

spec = importlib.util.spec_from_file_location('configure_users',Path(__file__).parents[1]/'scripts'/'configure_test_users.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.fixture
def setup(monkeypatch,tmp_path):
    credential=tmp_path/'credential.json'
    credential.write_text(json.dumps({'project_id':'finnos-app'}))
    monkeypatch.setattr(module.credentials,'Certificate',lambda raw:object())
    monkeypatch.setattr(module,'initialize_app',lambda *a,**kw:SimpleNamespace(project_id='finnos-app'))
    users={uid:SimpleNamespace(uid=uid,email=f'teste-{label.lower()}-{module.RUN}@finnos-preview.invalid',display_name=f'Teste-{label}') for label,(uid,email) in module.USERS.items()}
    monkeypatch.setattr(module.auth,'get_user',lambda uid,**kw:users[uid])
    def missing(*a,**kw):raise module.auth.UserNotFoundError('missing')
    monkeypatch.setattr(module.auth,'get_user_by_email',missing)
    class Document:
        def __init__(self,uid):self.path='users/'+uid
        def get(self):return SimpleNamespace(exists=False)
        def collections(self):return []
    class Client:
        project='finnos-app'
        def collection(self,name):
            assert name=='users'
            return SimpleNamespace(document=lambda uid:Document(uid) if uid in users else pytest.fail('Foreign UID accessed'))
    monkeypatch.setattr(module.firestore,'client',lambda **kw:Client())
    writes=[]
    for name in ('update_user','create_user','delete_user'):
        spy=Mock(side_effect=AssertionError('No write expected'))
        monkeypatch.setattr(module.auth,name,spy)
        writes.append(spy)
    monkeypatch.setattr(sys,'argv',['script','--credential',str(credential)])
    return writes


def test_dry_run_has_no_auth_writes_or_password_prompt(setup,monkeypatch,capsys):
    prompt=Mock(side_effect=AssertionError('No password expected'))
    monkeypatch.setattr(module.getpass,'getpass',prompt)
    module.main()
    assert json.loads(capsys.readouterr().out)['mode']=='inspection'
    assert all(not x.called for x in setup) and not prompt.called


def test_execute_without_tty_stops_before_password_and_writes(setup,monkeypatch):
    monkeypatch.setattr(sys,'argv',sys.argv+['--execute'])
    monkeypatch.setattr(sys.stdin,'isatty',lambda:False)
    with pytest.raises(ValueError,match='interactive terminal'):module.main()
    assert all(not x.called for x in setup)


def test_wrong_project_stops_before_identity_access(setup,monkeypatch):
    monkeypatch.setattr(module,'initialize_app',lambda *a,**kw:SimpleNamespace(project_id='finnos-dev'))
    with pytest.raises(ValueError,match='Authentication project'):module.main()
    assert all(not x.called for x in setup)


def test_email_collision_stops_before_any_change(setup,monkeypatch):
    monkeypatch.setattr(module.auth,'get_user_by_email',lambda *a,**kw:SimpleNamespace(uid='personal-user'))
    with pytest.raises(ValueError,match='another UID'):module.main()
    assert all(not x.called for x in setup)


def test_getpass_echo_warning_aborts_without_writes(setup,monkeypatch):
    monkeypatch.setattr(sys,'argv',sys.argv+['--execute'])
    monkeypatch.setattr(sys.stdin,'isatty',lambda:True)
    def prompt(*a):warnings.warn('echo fallback',module.getpass.GetPassWarning)
    monkeypatch.setattr(module.getpass,'getpass',prompt)
    with pytest.raises(module.getpass.GetPassWarning):module.main()
    assert all(not x.called for x in setup)
