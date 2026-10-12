from tests.test_firestore_finance import finance, account, tx


def test_goals_real_capacity_and_uid_isolation(finance):
    client,user,db=finance
    a=account(client)
    tx(client,a['id'],value=1000)
    tx(client,a['id'],value=100,type='despesa')
    suggestion=client.get('/api/goals/suggestion')
    assert suggestion.status_code==200, suggestion.text
    assert suggestion.json()['capacity']==900
    payload=dict(name='Reserva',category='Reserva',mode='inteligente',target=1000,saved=100,months=12,contribution=100.10,frequency='Mensal',account=a['id'],strategy='seguro')
    r=client.post('/api/goals',json=payload)
    assert r.status_code==201,r.text
    assert client.get('/api/goals/suggestion').json()['capacity']==799.90
    assert client.get('/api/accounts').json()[0]['balance']==1000
    assert next(d for p,d in db.data.items() if p[-2]=='goals')['target_cents']==100000
    user['uid']='test-b'
    assert client.get('/api/goals').json()==[]
    assert client.post('/api/goals',json=payload).status_code==400


def test_radar_and_subscription_contracts(finance):
    client,user,_=finance
    a=account(client)
    tx(client,a['id'],type='despesa',status='agendado',fixed=True,value=50)
    r=client.get('/api/radar')
    assert r.status_code==200,r.text
    assert client.get('/api/subscriptions').json()['monthly_total']==50
    user['uid']='test-b'
    assert client.get('/api/subscriptions').json()['items']==[]
    assert client.get('/api/radar').status_code==200


def test_ai_requires_explicit_cost_authorization_and_uses_scoped_context(finance,monkeypatch):
    from finnos.lib.ai_context import build_financial_context
    from finnos.lib import db as store
    import asyncio
    client,user,db=finance
    a=account(client,name='Somente A')
    tx(client,a['id'],value=1000)
    user['uid']='test-b'
    b=account(client,name='Somente B')
    tx(client,b['id'],value=2222)
    token=store.active_uid.set('test-b')
    try:
        context=asyncio.run(build_financial_context('test-b','2026-10'))
        assert 'Somente B' in context and 'Somente A' not in context
    finally:store.active_uid.reset(token)
    monkeypatch.delenv('FINNOS_AI_PAID_CALLS_ENABLED',raising=False)
    assert client.get('/api/ai/keys').json()==[]
    assert client.get('/api/ai/providers').status_code==200
    assert client.post('/api/ai/ask',json=dict(provider='openai',question='Quanto gastei?')).status_code==503
    assert client.post('/api/ai/feedback',json=dict(rating='up')).status_code==200


def test_radar_state_is_user_scoped_and_persisted(finance):
    client,user,db=finance
    r=client.post('/api/radar/synthetic-signal/action',json={'action':'view'})
    assert r.status_code==200,r.text
    assert any(p[-2]=='radar_states' for p in db.data)
    user['uid']='test-b'
    assert client.get('/api/radar').status_code==200


def test_simulation_uses_actual_balances_and_never_writes(finance):
    client,user,db=finance
    a=account(client,value=1000)
    tx(client,a['id'],type='despesa',value=100,installment=True,total_installments=3)
    before=dict(db.data)
    r=client.post('/api/simulate/purchase',json=dict(amount=100,installments=3))
    assert r.status_code==200,r.text
    assert r.json()['balance_now']==966.67 and r.json()['cash_impact_30d']==33.33
    assert db.data==before and r.json()['writes_data'] is False
    assert client.post('/api/simulate/purchase',json=dict(amount=100,card_id='foreign')).status_code==404
