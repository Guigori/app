from collections import defaultdict
from datetime import date,timedelta
from decimal import Decimal,ROUND_HALF_UP
from statistics import median
from .money import money_to_cents,cents_to_decimal
from .identity import deterministic_analysis_id,deterministic_radar_id
RULE_VERSION="category-change-v1.3";MIN_PATTERN_OBSERVATIONS=6;MIN_PATTERN_PERIODS=3
ELIGIBLE_ROLES={"purchase","expense"};REFUND_ROLES={"refund","reversal"}

def _role(t):
    if t.get("transaction_role"):return t["transaction_role"]
    if t.get("type")=="transferencia":return "own_transfer"
    return "purchase" if t.get("type")=="despesa" else "income"

def _amount(t):return money_to_cents(t.get("installment_value") or t.get("adjusted_value") or t.get("value") or 0)
def _purchase(t):return t.get("type")=="despesa" and t.get("status")=="pago" and _role(t) in ELIGIBLE_ROLES

def _severity(pct,delta):
    p=abs(Decimal(str(pct)));d=abs(delta)
    if p>=75 and d>=30000:return "critical"
    if p>=50 or d>=30000:return "high"
    if p>=25:return "medium"
    return "normal"

def _confidence(n,periods):
    score=round((min(n/18,1)*.65+min(periods/6,1)*.35)*100,1)
    return ("high" if score>=75 else "medium" if score>=45 else "low"),score

def _refunds(txs,as_of):
    byid={str(t.get("id")):t for t in txs if t.get("id") is not None};out=[]
    for t in txs:
        if t.get("status")!="pago" or _role(t) not in REFUND_ROLES:continue
        try:d=date.fromisoformat(t["date"])
        except (KeyError,TypeError,ValueError):continue
        if d>as_of:continue
        parent=byid.get(str(t.get("related_transaction_id"))) if t.get("related_transaction_id") else None
        cid=(parent or {}).get("category_id") or t.get("category_id")
        if cid:out.append((d,cid,-_amount(t),str(t.get("id")) if t.get("id") else None))
    return out

def _baseline(history,refunds,start,end,elapsed_days):
    totals=defaultdict(int)
    for d,t in history:totals[d.strftime("%Y-%m")]+=_amount(t)
    for d,_,amount,_ in refunds:
        if start<=d<end:totals[d.strftime("%Y-%m")]+=amount
    months=[];cur=date(start.year,start.month,1)
    while cur<end:
        months.append(max(0,totals.get(cur.strftime("%Y-%m"),0)))
        cur=date(cur.year+(cur.month==12),1 if cur.month==12 else cur.month+1,1)
    if not months:return 0
    ordered=sorted(Decimal(x) for x in months)
    if len(ordered)>=3:
        center=Decimal(str(median(ordered)));cap=max(Decimal("1"),center*Decimal("0.50"))
        robust=[max(center-cap,min(center+cap,x)) for x in ordered]
    else:robust=ordered
    monthly=sum(robust,Decimal(0))/Decimal(len(robust))
    return int((monthly*Decimal(elapsed_days)/Decimal(30)).quantize(Decimal("1"),rounding=ROUND_HALF_UP))

def category_change_analyses(txs,categories,*,as_of:date,limit=7):
    txs=list(txs);month=as_of.strftime("%Y-%m");ms=date(as_of.year,as_of.month,1);start=ms-timedelta(days=90);cats={c["id"]:c for c in categories}
    hist=defaultdict(list);current=defaultdict(list);refunds=_refunds(txs,as_of)
    for t in txs:
        if not _purchase(t) or not t.get("category_id"):continue
        try:d=date.fromisoformat(t["date"])
        except (KeyError,TypeError,ValueError):continue
        if start<=d<ms:hist[t["category_id"]].append((d,t))
        if ms<=d<=as_of:current[t["category_id"]].append((d,t))
    refund_current={cid for d,cid,_,_ in refunds if ms<=d<=as_of};out=[]
    for cid in set(current)|refund_current:
        rows=current.get(cid,[]);h=hist.get(cid,[]);periods={d.strftime("%Y-%m") for d,_ in h}
        if len(h)<MIN_PATTERN_OBSERVATIONS or len(periods)<MIN_PATTERN_PERIODS:continue
        cr=[r for r in refunds if r[1]==cid];base=_baseline(h,cr,start,ms,as_of.day)
        if base<5000:continue
        cur=sum(_amount(t) for _,t in rows)+sum(a for d,_,a,_ in cr if ms<=d<=as_of);delta=cur-base
        pct=Decimal(delta)/Decimal(base)*100 if base else Decimal(0)
        if abs(pct)<20 or abs(delta)<2500:continue
        hist_ticket=Decimal(str(median([_amount(t) for _,t in h])));expected=Decimal(len(h))/Decimal(90)*Decimal(as_of.day)
        freq=int(((Decimal(len(rows))-expected)*hist_ticket).quantize(Decimal("1"),rounding=ROUND_HALF_UP));ticket=delta-freq;den=abs(freq)+abs(ticket)
        drivers=[{"kind":"frequency","label":"Frequência","contribution_cents":freq,"contribution_percent":round(abs(freq)/den*100,1) if den else 0,"evidence":[]},{"kind":"ticket","label":"Valor por compra (resíduo explicativo)","contribution_cents":ticket,"contribution_percent":round(abs(ticket)/den*100,1) if den else 0,"evidence":[]}]
        drivers.sort(key=lambda x:-x["contribution_percent"]);dom=drivers[0]
        phrase=("mais compras" if freq>0 else "menos compras") if dom["kind"]=="frequency" else ("maior valor por compra" if ticket>0 else "menor valor por compra")
        conf,score=_confidence(len(h),len(periods));curids=[str(t["id"]) for _,t in rows if t.get("id")];histids=[str(t["id"]) for _,t in h if t.get("id")]
        aid=deterministic_analysis_id("spending-change","category",cid,month);rid=deterministic_radar_id("spending-change","category",cid,month) if pct>=25 else None
        out.append({"rule_version":RULE_VERSION,"analysis_id":aid,"kind":"spending_change","subject_type":"category","subject_id":cid,"subject_name":cats.get(cid,{}).get("name","Categoria"),"period":month,"headline":f"{cats.get(cid,{}).get('name','Categoria')} {'aumentou' if delta>0 else 'caiu'} {abs(pct):.0f}% em relação ao seu padrão","conclusion":f"A principal explicação é {phrase}.","current_value_cents":cur,"baseline_value_cents":base,"delta_cents":delta,"delta_percent":round(float(pct),1),"severity":_severity(pct,delta),"relevance_score":round(min(100,abs(float(pct))*.55+min(abs(delta),100000)/100000*35+score*.10),1),"confidence":conf,"confidence_score":score,"evidence":[{"label":"Gasto atual","value":f"R$ {cents_to_decimal(cur)}","source_ids":curids,"provenance":"observed"},{"label":"Baseline robusto","value":f"R$ {cents_to_decimal(base)}","source_ids":histids,"provenance":"observed"}],"drivers":drivers,"projection":{"status":"preliminary","low_cents":None,"expected_cents":None,"high_cents":None,"confidence":"low","reason":"Spending Velocity intra-period curve not established yet."},"requires_attention":pct>=25,"radar_id":rid})
    out.sort(key=lambda x:(-x["relevance_score"],x["analysis_id"]))
    return out if limit is None else out[:max(1,min(limit,7))]
