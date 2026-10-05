"""FCA — deterministic analytical reasoning shared by Radar, Análises and Finn."""
from collections import defaultdict
from datetime import date,timedelta
from lib.dates import today_iso
from lib.stats import month_portion

def _amount(tx): return float(tx.get("installment_value") or tx.get("adjusted_value") or tx.get("value") or 0)
def _confidence(days,count):
    score=round((min(days/90,1)*.55+min(count/12,1)*.45)*100,1)
    return ("high" if score>=75 else "medium" if score>=45 else "low"),score
def _severity(pct,impact):
    return "critical" if pct>=75 and impact>=300 else "high" if pct>=50 or impact>=300 else "medium" if pct>=25 else "normal"

def category_change_analyses(txs,categories,limit=7):
    today=date.fromisoformat(today_iso()); month=today.isoformat()[:7]; start=today-timedelta(days=90)
    cat_by_id={c["id"]:c for c in categories}; hist=defaultdict(list); current=defaultdict(list)
    for tx in txs:
        if tx.get("type")!="despesa" or tx.get("status")!="pago" or not tx.get("category_id"): continue
        try: d=date.fromisoformat(tx["date"])
        except (KeyError,ValueError,TypeError): continue
        if start<=d<today: hist[tx["category_id"]].append(tx)
        if tx["date"].startswith(month):
            portion=month_portion(tx,month)
            if portion is not None: current[tx["category_id"]].append((tx,float(portion)))
    elapsed=max(today.day,1); analyses=[]; nm=date(today.year+(today.month==12),1 if today.month==12 else today.month+1,1); md=(nm-timedelta(days=1)).day
    for cid,rows in current.items():
        history=hist.get(cid,[])
        if not history: continue
        ht=sum(_amount(t) for t in history); baseline=ht/90*elapsed; cur=sum(v for _,v in rows)
        if baseline<50: continue
        delta=cur-baseline; pct=delta/baseline*100
        if abs(pct)<20 or abs(delta)<25: continue
        hc=len(history); ec=hc/90*elapsed; cc=len(rows); hticket=ht/hc if hc else 0; cticket=cur/cc if cc else 0
        freq=(cc-ec)*hticket; ticket=cc*(cticket-hticket); denom=abs(freq)+abs(ticket)
        drivers=[{"kind":k,"label":l,"contribution":round(v,2),"contribution_percent":round(abs(v)/denom*100,1) if denom else 0,"evidence":[]} for k,l,v in (("frequency","Frequência",freq),("ticket","Valor médio por compra",ticket))]
        drivers.sort(key=lambda x:-x["contribution_percent"]); dom=drivers[0]; name=cat_by_id.get(cid,{}).get("name","Categoria")
        phrase=(("mais compras" if freq>0 else "menos compras") if dom["kind"]=="frequency" else ("maior valor médio por compra" if ticket>0 else "menor valor médio por compra"))
        conf,cs=_confidence(90,hc); proj=cur/elapsed*md; bm=ht/90*md
        analyses.append({"id":f"fca-category-change-{cid}-{month}","kind":"spending_change","subject_type":"category","subject_id":cid,"subject_name":name,"period":month,"headline":f"{name} {'aumentou' if delta>0 else 'caiu'} {abs(pct):.0f}% em relação ao seu padrão","conclusion":f"A principal explicação é {phrase}.","current_value":round(cur,2),"baseline_value":round(baseline,2),"delta":round(delta,2),"delta_percent":round(pct,1),"severity":_severity(abs(pct),abs(delta)),"relevance_score":round(min(100,abs(pct)*.55+min(abs(delta),1000)/1000*35+cs*.10),1),"confidence":conf,"confidence_score":cs,"evidence":[{"label":"Gasto atual","value":f"R$ {cur:.2f}"},{"label":"Esperado até hoje","value":f"R$ {baseline:.2f}"},{"label":"Compras no período","value":str(cc)},{"label":"Ticket médio","value":f"R$ {cticket:.2f}"},{"label":"Histórico analisado","value":"90 dias"}],"drivers":drivers,"projection":{"month_end":round(proj,2),"baseline_month_end":round(bm,2),"delta":round(proj-bm,2),"confidence":conf},"related_radar_id":f"pace-{cid}-{month}" if pct>=25 else None})
    analyses.sort(key=lambda a:(-a["relevance_score"],a["id"])); return analyses[:max(1,min(limit,7))]
