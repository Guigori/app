"""Invoice persistence, allocation and single-debit regression via actual routes."""
from tests.test_firestore_finance import finance, account, tx
from tests.test_firestore_cards import card


def pay(client, identifier, account_id, value=None, operation='pay-1', cycle='2026-10-20'):
    return client.post(f'/api/cards/{identifier}/pay',json=dict(account_id=account_id,date='2026-10-12',value=value,cycle=cycle),headers={'X-FINNOS-Operation-ID':operation})


def test_single_debit_partial_full_and_limit(finance):
    client, _, db = finance
    a = account(client,value=1000)
    c = card(client,a['id']).json()
    purchase = tx(client,a['id'],type='despesa',card_id=c['id'],value=100,installment=True,total_installments=3).json()
    assert client.get('/api/accounts').json()[0]['balance'] == 1000
    invoice = client.get(f"/api/cards/{c['id']}/invoice").json()
    assert invoice['total'] == 33.33
    r = pay(client,c['id'],a['id'],10)
    assert r.status_code == 200, r.text
    assert r.json()['paid'] is False and r.json()['outstanding'] == 23.33
    assert client.get('/api/accounts').json()[0]['balance'] == 990
    assert client.get('/api/cards').json()[0]['used'] == 90
    assert pay(client,c['id'],a['id'],10).json() == r.json()
    assert pay(client,c['id'],a['id'],11).status_code == 409
    assert pay(client,c['id'],a['id'],100,operation='overpay').status_code == 400
    assert pay(client,c['id'],a['id'],operation='remainder').json()['paid'] is True
    assert client.get('/api/accounts').json()[0]['balance'] == 966.67
    assert client.get('/api/dashboard?month=2026-10').json()['expense'] == 33.33
    assert client.get('/api/cards').json()[0]['used'] == 66.67
    assert pay(client,c['id'],a['id'],operation='duplicate').status_code == 400
    debit = next(t for t in client.get('/api/transactions').json() if t['invoice_payment'])
    assert client.delete('/api/transactions/'+debit['id']).status_code == 409
    assert client.delete('/api/transactions/'+purchase['id']).status_code == 409
    assert any(d.get('value_cents') == 1000 for p,d in db.data.items() if p[-2]=='transactions')


def test_purchase_after_closing_and_historical_unpaid_limit(finance):
    client, _, _ = finance
    a = account(client,value=1000)
    c = card(client,a['id'],closing_day=10).json()
    tx(client,a['id'],type='despesa',card_id=c['id'],value=100,installment=True,total_installments=3,date='2026-09-11')
    assert client.get(f"/api/cards/{c['id']}/invoice?cycle=2026-09-10").json()['total'] == 0
    assert client.get(f"/api/cards/{c['id']}/invoice?cycle=2026-10-10").json()['total'] == 33.33
    assert client.get(f"/api/cards/{c['id']}/invoice?cycle=2026-12-10").json()['total'] == 33.34
    assert client.get('/api/cards').json()[0]['used'] == 100
    assert pay(client,c['id'],a['id'],cycle='2026-10-10').status_code == 200
    assert client.get('/api/cards').json()[0]['used'] == 66.67


def test_payment_foreign_references_and_invalid_dates_are_atomic(finance):
    client, user, db = finance
    a = account(client)
    c = card(client,a['id']).json()
    tx(client,a['id'],type='despesa',card_id=c['id'],value=20)
    before = dict(db.data)
    assert pay(client,c['id'],'missing').status_code == 400
    assert db.data == before
    user['uid']='test-b'
    b = account(client)
    assert pay(client,c['id'],b['id']).status_code == 404
    user['uid']='test-a'
    assert pay(client,c['id'],b['id']).status_code == 400
    assert client.post(f"/api/cards/{c['id']}/pay",json=dict(account_id=a['id'],date='2026-02-31')).status_code == 422
