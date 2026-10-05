"""FINNOS Radar Intelligence Engine.

Deterministic by design: builds a personal 90-day baseline, detects anomalies,
card pressure, future commitments and cash-flow opportunities without LLM cost.
Signals are regenerated from current data; user state/feedback is persisted.
"""
import uuid
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import mean
from fastapi import APIRouter, Depends, HTTPException

from lib.db import db
from lib.dates import today_iso
from lib.stats import add_months, month_portion
from lib.radar_patterns import recurring_signals
from models.radar import RadarActionIn, RadarFeedbackIn, RadarOut, RadarSignalOut
from routers.auth import require_user
from routers.cards import _build as build_card, _context as card_context

router = APIRouter(prefix="/radar", tags=["radar"])
POSITIONS = [326, 34, 92, 178, 232, 286, 138]

def brl(v: float) -> str:
    raw=f"{v:,.2f}"; return "R$ "+raw.replace(",","X").replace(".",",").replace("X",".")

def month_end(m: str) -> str:
    y,mo=map(int,m.split("-")); return f"{m}-{monthrange(y,mo)[1]:02d}"

def days_until(iso: str) -> int:
    return (date.fromisoformat(iso)-date.fromisoformat(today_iso())).days

async def _state_map(user_id: str) -> dict:
    docs=await db.radar_states.find({"user_id":user_id}).to_list(5000)
    return {d["signal_id"]:d for d in docs}

async def _signals(user_id: str) -> list[dict]:
    today=date.fromisoformat(today_iso()); today_s=today.isoformat(); month=today_s[:7]
    start90=(today-timedelta(days=90)).isoformat()
    txs=await db.transactions.find({"user_id":user_id}).to_list(20000)
    cats=await db.categories.find({"user_id":user_id}).to_list(500)
    cat_by_id={c["id"]:c for c in cats}
    signals=[]

    # 90-day personal baseline: category daily pace and individual purchase size.
    hist=[t for t in txs if t.get("type")=="despesa" and t.get("status")=="pago" and start90<=t["date"]<today_s]
    by_cat=defaultdict(list)
    current_cat=defaultdict(float)
    for t in hist:
        if t.get("category_id"): by_cat[t["category_id"]].append(float(t.get("adjusted_value") or t["value"]))
    for t in txs:
        if t.get("type")=="despesa" and t.get("status")=="pago" and t["date"].startswith(month) and t.get("category_id"):
            p=month_portion(t,month)
            if p is not None: current_cat[t["category_id"]]+=p

    elapsed=max(today.day,1)
    for cid,current in current_cat.items():
        vals=by_cat.get(cid,[])
        cat=cat_by_id.get(cid,{})
        # Compare monthly pace against prior 90-day daily baseline.
        hist_total=sum(vals)
        hist_days=90
        expected=hist_total/hist_days*elapsed if hist_total else 0
        if expected>=50 and current>expected*1.25:
            pct=round((current/expected-1)*100)
            signals.append(dict(id=f"pace-{cid}-{month}",type="deviation",severity="high" if pct>=50 else "medium",
              title=f"{cat.get('name','Categoria')} está acima do seu padrão",description=f"+{pct}% em relação ao seu ritmo dos últimos 90 dias",
              explanation=f"Até hoje, seu padrão de 90 dias indicaria cerca de {brl(expected)}. Neste mês já foram {brl(current)}.",
              metric=f"+{pct}%",score=70+min(pct,80)/4,related_entity_type="category",related_entity_id=cid,
              expires_at=month_end(month),evidence=[{"label":"Esperado até hoje","value":brl(expected)},{"label":"Gasto atual","value":brl(current)},{"label":"Base analisada","value":"90 dias"}]))

        budget=float(cat.get("monthly_budget") or 0)
        if budget>0 and current/budget>=.85:
            pct=current/budget*100; critical=pct>=100
            signals.append(dict(id=f"budget-{cid}-{month}",type="risk",severity="critical" if critical else "high",
              title=f"{cat.get('name','Categoria')} {'passou' if critical else 'está perto'} do orçamento",
              description=f"{brl(current)} de {brl(budget)} planejados",explanation=f"Você já utilizou {pct:.0f}% do orçamento definido para esta categoria.",
              metric=f"{pct:.0f}%",score=98 if critical else 88,related_entity_type="category",related_entity_id=cid,
              expires_at=month_end(month),evidence=[{"label":"Orçamento","value":brl(budget)},{"label":"Utilizado","value":brl(current)}]))

    # Transaction anomalies vs personal category purchase size.
    for t in txs:
        if t.get("type")!="despesa" or t.get("status")!="pago" or t["date"]< (today-timedelta(days=7)).isoformat(): continue
        vals=by_cat.get(t.get("category_id"),[])
        if len(vals)<5: continue
        avg=mean(vals); value=float(t.get("adjusted_value") or t["value"])
        if avg>=20 and value>=max(avg*2.5,avg+100):
            signals.append(dict(id=f"anomaly-{t['id']}",type="deviation",severity="high",title=f"Gasto fora do seu padrão: {t['name']}",
              description=f"{brl(value)} · sua média semelhante é {brl(avg)}",explanation="Este lançamento ficou muito acima do valor típico das suas compras nessa categoria nos últimos 90 dias.",
              metric=f"{value/avg:.1f}×",score=82,related_entity_type="transaction",related_entity_id=t["id"],expires_at=(today+timedelta(days=7)).isoformat(),
              evidence=[{"label":"Compra","value":brl(value)},{"label":"Média pessoal","value":brl(avg)}]))

    # Duplicate candidates: same normalized name/value/date.
    seen={}
    for t in sorted(hist,key=lambda x:x["date"],reverse=True):
        key=(t.get("name","").strip().lower(),round(float(t.get("adjusted_value") or t["value"]),2),t["date"])
        if key in seen:
            signals.append(dict(id=f"duplicate-{t['id']}",type="risk",severity="high",title="Possível cobrança duplicada",
              description=f"{t['name']} aparece duas vezes por {brl(key[1])}",explanation="Encontramos dois lançamentos com mesmo nome, valor e data. Vale conferir antes de considerar ambos corretos.",
              metric=brl(key[1]),score=92,related_entity_type="transaction",related_entity_id=t["id"],expires_at=(today+timedelta(days=14)).isoformat(),
              evidence=[{"label":"Valor","value":brl(key[1])},{"label":"Data","value":t["date"]}]))
        seen[key]=t["id"]

    # Cards: pressure, closing and future installments. Historical invoice baseline
    # approximates the last 3 calendar months of card expenses.
    card_docs=await db.cards.find({"user_id":user_id,"active":True}).to_list(200)
    card_txs,accounts=await card_context(user_id)
    for doc in card_docs:
        card=await build_card(doc,card_txs,accounts); close=days_until(card.next_closing)
        monthly=[]
        for offset in (1,2,3):
            m=add_months(month,-offset)
            total=sum((month_portion(t,m) or 0) for t in card_txs if t.get("card_id")==card.id and t.get("type")=="despesa")
            if total>0: monthly.append(total)
        avg3=mean(monthly) if monthly else 0
        if avg3>=100 and card.current_invoice>avg3*1.15:
            pct=round((card.current_invoice/avg3-1)*100)
            signals.append(dict(id=f"card-trend-{card.id}-{card.next_closing}",type="risk",severity="critical" if pct>=35 else "high",
              title=f"Fatura {card.name} acima das últimas faturas",description=f"+{pct}% sobre a média recente",explanation=f"A fatura atual está em {brl(card.current_invoice)}; a média dos últimos {len(monthly)} meses foi {brl(avg3)}.",
              metric=f"+{pct}%",score=97 if pct>=35 else 89,related_entity_type="card",related_entity_id=card.id,expires_at=card.next_closing,
              evidence=[{"label":"Fatura atual","value":brl(card.current_invoice)},{"label":"Média recente","value":brl(avg3)}]))
        elif 0<=close<=4 and not card.invoice_paid:
            signals.append(dict(id=f"card-close-{card.id}-{card.next_closing}",type="information",severity="normal",title=f"Cartão {card.name} fecha em {close} dia{'s' if close!=1 else ''}",
              description="Compras novas em breve irão para a próxima fatura",explanation="O FINNOS acompanha o ciclo do cartão para você saber quando novas compras mudam de fatura.",
              score=50+(4-close)*2,related_entity_type="card",related_entity_id=card.id,expires_at=card.next_closing,evidence=[{"label":"Fatura atual","value":brl(card.current_invoice)}]))
        if card.future_installments>=500:
            signals.append(dict(id=f"future-{card.id}-{month}",type="information",severity="normal",title=f"{brl(card.future_installments)} já comprometidos no {card.name}",
              description="Parcelas futuras já ocupam parte do seu limite",explanation="Esse valor corresponde às parcelas que ainda chegarão nas próximas faturas.",
              metric=brl(card.future_installments),score=45,related_entity_type="card",related_entity_id=card.id,expires_at=month_end(month),
              evidence=[{"label":"Parcelas futuras","value":brl(card.future_installments)}]))

    # Overdue commitments: registered expenses that should already have been paid.
    overdue=[t for t in txs if t.get("type")=="despesa" and t.get("status") in ("pendente","agendado") and t.get("date","9999")<today_s]
    for t in sorted(overdue,key=lambda x:x.get("date",""))[:5]:
        value=float(t.get("adjusted_value") or t.get("value") or 0)
        late=(today-date.fromisoformat(t["date"])).days
        signals.append(dict(id=f"overdue-{t['id']}",type="risk",severity="critical" if late>=7 else "high",
          title=f"Pagamento em atraso: {t.get('name','Despesa')}",description=f"{brl(value)} venceu há {late} dia{'s' if late!=1 else ''}",
          explanation="Este compromisso está cadastrado como pendente ou agendado e a data prevista já passou. Confirme o pagamento ou revise o lançamento.",
          metric=brl(value),score=99 if late>=7 else 94,related_entity_type="transaction",related_entity_id=t["id"],
          expires_at=None,evidence=[{"label":"Vencimento","value":t["date"]},{"label":"Dias em atraso","value":str(late)},{"label":"Valor","value":brl(value)}]))

    # Cash-flow projection: paid balance plus pending/scheduled entries over 30 days.
    accounts=await db.accounts.find({"user_id":user_id}).to_list(500)
    balance=sum(float(a.get("initial_balance") or 0) for a in accounts)
    for t in txs:
        if t.get("status")=="pago" and t["date"]<=today_s:
            v=float(t.get("adjusted_value") or t["value"])
            if t["type"]=="receita": balance+=v
            elif t["type"]=="despesa": balance-=v
    projected=balance; negative_date=None
    future=sorted([t for t in txs if t.get("status") in ("pendente","agendado") and today_s<=t["date"]<=(today+timedelta(days=30)).isoformat()],key=lambda x:x["date"])
    for t in future:
        v=float(t.get("adjusted_value") or t["value"])
        projected += v if t["type"]=="receita" else -v if t["type"]=="despesa" else 0
        if projected<0 and not negative_date: negative_date=t["date"]
    if negative_date:
        signals.append(dict(id=f"cash-negative-{negative_date}",type="risk",severity="critical",title="Seu saldo projetado pode ficar negativo",
          description=f"Projeção indica saldo abaixo de zero em {negative_date[8:10]}/{negative_date[5:7]}",explanation="O FINNOS somou seu saldo atual aos lançamentos pendentes e agendados dos próximos 30 dias.",
          metric=brl(projected),score=100,related_entity_type="cashflow",expires_at=negative_date,evidence=[{"label":"Saldo atual","value":brl(balance)},{"label":"Projeção 30 dias","value":brl(projected)}]))
    elif future and projected>balance and projected>=200:
        signals.append(dict(id=f"cash-opportunity-{month}",type="opportunity",severity="normal",title="Sua projeção abre espaço para uma meta",
          description=f"Saldo projetado de {brl(projected)} nos próximos 30 dias",explanation="Considerando os lançamentos já programados, sua projeção permanece positiva. Você pode avaliar direcionar parte para uma meta.",
          metric=brl(projected),score=40,related_entity_type="cashflow",expires_at=(today+timedelta(days=7)).isoformat(),evidence=[{"label":"Projeção 30 dias","value":brl(projected)}]))

    # Recurrence detection: propose, never silently convert a transaction.
    signals.extend(await recurring_signals(user_id, month_end(month)))

    # Avoid a weaker pace signal when a category already has a budget risk.
    risky={s.get("related_entity_id") for s in signals if s["id"].startswith("budget-")}
    signals=[s for s in signals if not(s["id"].startswith("pace-") and s.get("related_entity_id") in risky)]
    states=await _state_map(user_id); out=[]
    for s in signals:
        st=states.get(s["id"],{})
        if st.get("state") in ("dismissed","resolved"): continue
        if st.get("dont_show_similar"): continue
        s["state"]=st.get("state","new"); s["detected_at"]=st.get("detected_at") or datetime.now(timezone.utc).isoformat()
        out.append(s)
    out.sort(key=lambda s:(-s["score"],s["id"]))
    for i,s in enumerate(out): s["radar_position"]=POSITIONS[i%len(POSITIONS)]
    return out

@router.get("",response_model=RadarOut)
async def radar(user:dict=Depends(require_user))->RadarOut:
    items=[RadarSignalOut(**s) for s in await _signals(user["id"])]
    return RadarOut(items=items,count=len(items),active_count=len(items))

@router.post("/{signal_id}/action")
async def radar_action(signal_id:str,payload:RadarActionIn,user:dict=Depends(require_user)):
    state={"view":"viewed","dismiss":"dismissed","resolve":"resolved"}[payload.action]
    await db.radar_states.update_one({"user_id":user["id"],"signal_id":signal_id},{"$set":{"state":state,"updated_at":datetime.now(timezone.utc)},"$setOnInsert":{"detected_at":datetime.now(timezone.utc)}},upsert=True)
    return {"ok":True,"state":state}

@router.post("/{signal_id}/feedback")
async def radar_feedback(signal_id:str,payload:RadarFeedbackIn,user:dict=Depends(require_user)):
    doc={"id":str(uuid.uuid4()),"user_id":user["id"],"signal_id":signal_id,"feedback":payload.feedback,"note":payload.note,"created_at":datetime.now(timezone.utc)}
    await db.radar_feedback.insert_one(doc)
    update={"last_feedback":payload.feedback,"updated_at":datetime.now(timezone.utc)}
    if payload.feedback=="dont_show_similar": update["dont_show_similar"]=True
    await db.radar_states.update_one({"user_id":user["id"],"signal_id":signal_id},{"$set":update,"$setOnInsert":{"detected_at":datetime.now(timezone.utc)}},upsert=True)
    return {"ok":True}
