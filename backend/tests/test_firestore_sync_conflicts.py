from tests.test_firestore_finance import finance, account, tx


def test_offline_update_conflict_and_durable_replay(finance):
    client,_,_=finance
    a=account(client)
    initial=tx(client,a['id']).json()
    payload=dict(name='Offline A',value=10,type='despesa',date='2026-10-12',account_id=a['id'])
    headers={'X-FINNOS-Operation-ID':'offline-edit','X-FINNOS-Base-Version':'1'}
    first=client.put('/api/transactions/'+initial['id'],json=payload,headers=headers)
    assert first.status_code==200 and first.json()['version']==2
    changed={**payload,'name':'Outro dispositivo','value':99}
    assert client.put('/api/transactions/'+initial['id'],json=changed,headers={'X-FINNOS-Base-Version':'1'}).status_code==409
    later=client.put('/api/transactions/'+initial['id'],json=changed,headers={'X-FINNOS-Base-Version':'2'})
    assert later.json()['version']==3
    retry=client.put('/api/transactions/'+initial['id'],json=payload,headers=headers)
    assert retry.status_code==200 and retry.json()['name']=='Outro dispositivo'
    assert client.put('/api/transactions/'+initial['id'],json=changed,headers=headers).status_code==409


def test_create_operation_rejects_changed_body_after_edit(finance):
    client,_,_=finance
    a=account(client)
    payload=dict(name='Compra offline',value=10,type='despesa',date='2026-10-12',account_id=a['id'])
    headers={'X-FINNOS-Operation-ID':'offline-create'}
    first=client.post('/api/transactions',json=payload,headers=headers)
    assert first.status_code==201
    assert client.post('/api/transactions',json={**payload,'value':20},headers=headers).status_code==409
    assert client.put('/api/transactions/'+first.json()['id'],json={**payload,'name':'Editada'}).status_code==200
    retry=client.post('/api/transactions',json=payload,headers=headers)
    assert retry.status_code==201 and retry.json()['name']=='Editada'
    assert len(client.get('/api/transactions').json())==1
