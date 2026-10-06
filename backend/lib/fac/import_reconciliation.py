import hashlib,re,unicodedata
from collections import Counter,defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
from .money import money_to_cents
STOPWORDS={"pagamento","compra","pix","debito","credito","cartao","boleto","pgto","pag"}

def normalize_description(value:str,*,remove_stopwords:bool=False)->str:
    raw=unicodedata.normalize("NFKD",value or "").encode("ascii","ignore").decode("ascii").lower()
    words=re.sub(r"[^a-z0-9 ]+"," ",raw).split()
    if remove_stopwords:words=[w for w in words if w not in STOPWORDS]
    return " ".join(words)

def _base(user_id,row):
    c="|".join([user_id,row["account_id"],row.get("card_id") or "",row["date"],normalize_description(row.get("description") or ""),str(money_to_cents(row["value"])),row["tx_type"]])
    return hashlib.sha256(c.encode()).hexdigest()

def import_keys(user_id:str,rows:list[dict])->list[str]:
    seen=defaultdict(int);out=[]
    for row in rows:
        base=_base(user_id,row);occ=seen[base];seen[base]+=1;out.append(f"{base}#{occ}")
    return out

def plan_import(keys:list[str],existing_keys)->tuple[list[int],list[int]]:
    available=Counter(existing_keys);new=[];skipped=[]
    for i,key in enumerate(keys):
        if available[key]>0:available[key]-=1;skipped.append(i)
        else:new.append(i)
    return new,skipped

def import_row_fingerprint(*,user_id,account_id,card_id,source_id,row_sequence,date,description,value,tx_type):
    """Deprecated. Compatibility only; new importer must use import_keys()."""
    canonical="|".join([user_id,account_id,card_id or "",source_id,str(row_sequence),date,normalize_description(description),str(money_to_cents(value)),tx_type])
    return hashlib.sha256(canonical.encode()).hexdigest()

@dataclass(frozen=True)
class MatchResult:
    level:str
    score:float

def manual_match(imported,manual,day_distance):
    if day_distance>3 or imported.get("account_id")!=manual.get("account_id"):return MatchResult("none",0)
    if money_to_cents(imported.get("value"))!=money_to_cents(manual.get("value")):return MatchResult("none",0)
    a=normalize_description(imported.get("name") or imported.get("description") or "",remove_stopwords=True)
    b=normalize_description(manual.get("name") or "",remove_stopwords=True)
    if not a or not b:return MatchResult("review",.5)
    ratio=SequenceMatcher(None,a,b).ratio();ta,tb=set(a.split()),set(b.split());overlap=len(ta&tb)/max(len(ta|tb),1);score=max(ratio,overlap)
    if ratio>=.82 or overlap>=.75:return MatchResult("high",round(score,3))
    if ratio>=.60 or overlap>=.50:return MatchResult("review",round(score,3))
    return MatchResult("none",round(score,3))
