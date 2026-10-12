from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from finnos.lib import db

@pytest.mark.parametrize('expected,actual,allowed',[('finnos-app','finnos-app',True),('finnos-dev','finnos-app',False),('finnos-dev','finnos-dev',False),(None,'finnos-dev',False)])
def test_preview_project_guard(monkeypatch,expected,actual,allowed):
    monkeypatch.setenv('VERCEL_ENV','preview')
    if expected:monkeypatch.setenv('FIREBASE_PROJECT_ID',expected)
    else:monkeypatch.delenv('FIREBASE_PROJECT_ID',raising=False)
    monkeypatch.setattr(db,'firebase_application',lambda:None)
    monkeypatch.setattr(db.firestore,'client',lambda **kw:SimpleNamespace(project=actual))
    if allowed:assert db.client().project=='finnos-app'
    else:
        with pytest.raises(HTTPException) as error:db.client()
        assert error.value.status_code==503
