"""Read-only source planning and isolated rehearsal; no production cutover.

Input is a local JSON export with collections as keys and arrays of records.
Ownership must be attested in a separately reviewed mapping. No guesses from
matching names. Writes are restricted to finnos-dev/migration_runs/<run>/users.
The original dump remains the recovery source; plans exclude auth secrets.
"""
import argparse
import hashlib
import json
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

COLLECTIONS = ('users','accounts','categories','transactions','cards','budget_cycles','subscriptions','goals','radar_states','radar_feedback','notify_prefs','notification_states')
MONEY = {'value','adjusted_value','installment_value','initial_balance','monthly_budget','monthly_goal','limit','amount','planned','expected_income','target','saved','contribution'}
PRIVATE = {'password_hash','verification_code_hash','verification_expires_at','verification_attempts','verification_sent_at','reset_password_hash','reset_password_expires_at','ciphertext','key','password','access_token','refresh_token'}
REFERENCES = {'transactions':{'account_id':'accounts','to_account_id':'accounts','card_id':'cards','category_id':'categories'},'cards':{'payment_account_id':'accounts'},'goals':{'account':'accounts'}}


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def clean(value):
    if isinstance(value, list): return [clean(x) for x in value]
    if not isinstance(value,dict): return value
    result={}
    for key, item in value.items():
        if key in PRIVATE or key == '_id': continue
        if key in MONEY and item is not None:
            if isinstance(item,dict) and '$numberDecimal' in item:item=item['$numberDecimal']
            decimal=Decimal(str(item))
            exact=decimal*100
            if not decimal.is_finite() or exact != exact.to_integral_value(): raise ValueError('Monetary precision requires reviewed reconciliation')
            result[key+'_cents']=int(exact)
        elif isinstance(item,dict) and set(item)=={'$date'}:
            if isinstance(item['$date'],str):result[key]=item['$date']
            else:raise ValueError('Export dates must use ISO extended JSON')
        else:result[key]=clean(item)
    return result


def prepare(source, ownership):
    if set(source) - set(COLLECTIONS):raise ValueError("Unclassified source collections require inventory review")
    profiles={str(u['id']):u for u in source.get('users',[])}
    mapping={}
    for row in ownership:
        if not row.get('evidence') or not row.get('verified_by') or row.get('approved') is not True:raise ValueError('Unverified ownership mapping')
        legacy,uid=str(row['legacy_user_id']),str(row['firebase_uid'])
        if legacy not in profiles or not uid or '/' in uid or legacy in mapping:raise ValueError('Invalid ownership mapping')
        mapping[legacy]=uid
    if len(mapping.values()) != len(set(mapping.values())):raise ValueError('Multiple legacy users require explicit consolidation review')
    index={}
    for name in COLLECTIONS:
        index[name]={}
        for raw in source.get(name,[]):
            if not raw.get('id'):raise ValueError('Missing stable application identifier')
            identifier=str(raw['id'])
            if '/' in identifier or not identifier or len(identifier)>1500:raise ValueError('Invalid stable identifier')
            if name=='transactions':date.fromisoformat(raw['date'])
            owner=identifier if name=='users' else str(raw.get('user_id') or '')
            key=(owner,identifier)
            if key in index[name]:raise ValueError('Duplicate application identifier')
            index[name][key]=raw
    entries=[]
    for name in COLLECTIONS:
        for (owner,identifier),raw in index[name].items():
            if owner not in mapping:raise ValueError('Unmapped source ownership; no records will be assigned')
            for field,target in REFERENCES.get(name,{}).items():
                linked=raw.get(field)
                if linked and (owner,str(linked)) not in index[target]:raise ValueError('Missing or foreign financial reference')
            if name=='budget_cycles':
                for allocation in raw.get('allocations',[]):
                    if (owner,str(allocation['category_id'])) not in index['categories']:raise ValueError('Missing budget category')
            doc=clean(raw)
            uid=mapping[owner]
            if name!='users':doc['user_id']=uid
            doc['legacy_user_id']=owner
            path=f'users/{uid}/profile/legacy' if name=='users' else f'users/{uid}/{name}/{identifier}'
            entries.append({'path':path,'document':doc,'sha256':digest(doc)})
    return {'version':1,'source_sha256':digest(source),'counts':{name:len(source.get(name,[])) for name in COLLECTIONS},'documents':entries,'plan_sha256':digest(entries)}


def rehearsal(plan, db, run):
    if db.project!='finnos-dev' or not run or '/' in run:raise ValueError('Rehearsal requires isolated finnos-dev run')
    for entry in plan['documents']:
        ref=db.document(f"migration_runs/{run}/{entry['path']}")
        old=ref.get()
        if old.exists:
            if digest(old.to_dict()) != entry['sha256']:raise ValueError('Target divergence; stop without overwriting')
        else:ref.create(entry['document'])
    for entry in plan['documents']:
        snapshot=db.document(f"migration_runs/{run}/{entry['path']}").get()
        if not snapshot.exists or digest(snapshot.to_dict())!=entry['sha256']:raise ValueError('Read-back integrity failed')
    return {'verified_documents':len(plan['documents']),'plan_sha256':plan['plan_sha256'],'run':run,'production_writes':False}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--export',required=True);parser.add_argument('--ownership',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--rehearse',action='store_true');parser.add_argument('--run')
    args=parser.parse_args()
    plan=prepare(json.loads(Path(args.export).read_text()),json.loads(Path(args.ownership).read_text()))
    target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as handle:json.dump(plan,handle,ensure_ascii=False)
    result={'mode':'dry-run','counts':plan['counts'],'plan_sha256':plan['plan_sha256']}
    if args.rehearse:
        import firebase_admin
        from firebase_admin import firestore
        app=firebase_admin.initialize_app(options={'projectId':'finnos-dev'},name='isolated-rehearsal')
        result=rehearsal(plan,firestore.client(app=app),args.run)
    print(json.dumps(result))

if __name__=='__main__':main()
