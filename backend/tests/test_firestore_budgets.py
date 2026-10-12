from tests.test_firestore_finance import finance, account, tx


def plan(category_id, **changes):
    return dict(mode='personalizado',period='mensal',start_date='2026-10-01',end_date='2026-10-31',expected_income=1000.10,allocations=[dict(category_id=category_id,planned=100.11)],**changes)


def test_budget_cents_overlap_progress_and_foreign_refs(finance):
    client, identity, db = finance
    a = account(client)
    cat = client.post('/api/categories',json=dict(name='Mercado')).json()
    tx(client,a['id'],type='despesa',value=100,installment=True,total_installments=3,category_id=cat['id'])
    r = client.post('/api/budgets',json=plan(cat['id']))
    assert r.status_code == 201, r.text
    cycle = r.json()
    assert client.get('/api/budgets/current').json()['id'] == cycle['id']
    assert client.post('/api/budgets',json=plan(cat['id'])).status_code == 409
    p = client.get(f"/api/budgets/{cycle['id']}/progress").json()
    assert p['spent'] == 33.33 and p['available'] == 66.78
    stored = next(d for path,d in db.data.items() if path[-2] == 'budget_cycles')
    assert stored['allocations'][0]['planned_cents'] == 10011
    assert stored['expected_income_cents'] == 100010
    identity['uid']='test-b'
    assert client.get('/api/budgets').json() == []
    assert client.get(f"/api/budgets/{cycle['id']}/progress").status_code == 404
    assert client.post('/api/budgets',json=plan(cat['id'])).status_code == 400


def test_closed_budget_and_invalid_payload(finance):
    client, _, _ = finance
    cat = client.post('/api/categories',json=dict(name='Meta')).json()
    payload=plan(cat['id']); payload.update(start_date='2026-01-01',end_date='2026-01-31')
    created=client.post('/api/budgets',json=payload).json()
    assert client.put('/api/budgets/'+created['id'],json=payload).status_code == 409
    payload['user_id']='foreign'
    assert client.post('/api/budgets',json=payload).status_code == 422


def test_budget_suggestion_without_categories_and_next_cycle(finance):
    client,_,_=finance
    a=account(client)
    tx(client,a['id'],value=1000,date='2026-09-12')
    r=client.get('/api/budgets/suggestion')
    assert r.status_code==200 and r.json()['expected_income']==333.33
    payload=dict(mode='503020',period='mensal',start_date='2026-11-01',end_date='2026-11-30',expected_income=1000)
    created=client.post('/api/budgets',json=payload).json()
    assert client.get('/api/budgets/current').json() is None
    assert client.get('/api/budgets/next').json()['id']==created['id']
