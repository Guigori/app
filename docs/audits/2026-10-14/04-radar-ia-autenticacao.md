# Comparação linha a linha — Radar, IA e autenticação

Arquivos `Guigori/app/main` em 14/10/2026. `=` linhas idênticas, `-` código legado, `+` código Firebase/Vercel. A autenticação migrou de rotas MongoDB para sessões verificadas no entrypoint Vercel; os arquivos não têm equivalência direta.


## backend/routers/radar.py ↔ frontend/finnos/routers/radar.py

Linhas legado 203; ativo 176.

```text
L---- | F---- | código
+ ---- | 0001 | from finnos.lib.money import D, installment_portion, FinanceModel, Money
= 0001 | 0002 | """FINNOS Radar Intelligence Engine.
= 0002 | 0003 | 
= 0003 | 0004 | Deterministic by design: builds a personal 90-day baseline, detects anomalies,
= 0004 | 0005 | card pressure, future commitments and cash-flow opportunities without LLM cost.
= 0005 | 0006 | Signals are regenerated from current data; user state/feedback is persisted.
= 0006 | 0007 | """
= 0007 | 0008 | import uuid
= 0008 | 0009 | from calendar import monthrange
= 0009 | 0010 | from collections import defaultdict
= 0010 | 0011 | from datetime import date, datetime, timedelta, timezone
= 0011 | 0012 | from statistics import mean
= 0012 | 0013 | from fastapi import APIRouter, Depends, HTTPException
- 0013 | ---- | 
- 0014 | ---- | from lib.db import db
- 0015 | ---- | from lib.dates import today_iso
- 0016 | ---- | from lib.stats import add_months, month_portion
- 0017 | ---- | from lib.radar_patterns import recurring_signals
- 0018 | ---- | from models.radar import RadarActionIn, RadarFeedbackIn, RadarOut, RadarSignalOut
- 0019 | ---- | from routers.auth import require_user
- 0020 | ---- | from routers.cards import _build as build_card, _context as card_context
- 0021 | ---- | 
- 0022 | ---- | router = APIRouter(prefix="/radar", tags=["radar"])
+ ---- | 0014 | from finnos.lib.db import db
+ ---- | 0015 | from finnos.lib.dates import today_iso
+ ---- | 0016 | from finnos.lib.stats import add_months, month_portion, balance_effects
+ ---- | 0017 | from finnos.lib.radar_patterns import recurring_signals
+ ---- | 0018 | from finnos.models.radar import RadarActionIn, RadarFeedbackIn, RadarOut, RadarSignalOut
+ ---- | 0019 | from finnos.routers.auth import require_user
+ ---- | 0020 | from finnos.routers.cards import _build as build_card, _context as card_context
+ ---- | 0021 | router = APIRouter(prefix='/radar', tags=['radar'])
= 0023 | 0022 | POSITIONS = [326, 34, 92, 178, 232, 286, 138]
= 0024 | 0023 | 
= 0025 | 0024 | def brl(v: float) -> str:
- 0026 | ---- |     raw=f"{v:,.2f}"; return "R$ "+raw.replace(",","X").replace(".",",").replace("X",".")
+ ---- | 0025 |     raw = f'{v:,.2f}'
+ ---- | 0026 |     return 'R$ ' + raw.replace(',', 'X').replace('.', ',').replace('X', '.')
= 0027 | 0027 | 
= 0028 | 0028 | def month_end(m: str) -> str:
- 0029 | ---- |     y,mo=map(int,m.split("-")); return f"{m}-{monthrange(y,mo)[1]:02d}"
+ ---- | 0029 |     (y, mo) = map(int, m.split('-'))
+ ---- | 0030 |     return f'{m}-{monthrange(y, mo)[1]:02d}'
= 0030 | 0031 | 
= 0031 | 0032 | def days_until(iso: str) -> int:
- 0032 | ---- |     return (date.fromisoformat(iso)-date.fromisoformat(today_iso())).days
+ ---- | 0033 |     return (date.fromisoformat(iso) - date.fromisoformat(today_iso())).days
= 0033 | 0034 | 
+ ---- | 0035 | def _settled_cash_balance(accounts: list[dict], txs: list[dict], today: str):
+ ---- | 0036 |     """Same effective bank balance as Home; card purchases are not bank debits."""
+ ---- | 0037 |     balance = sum((D(a.get('initial_balance') or 0) for a in accounts), D(0))
+ ---- | 0038 |     for tx in txs:
+ ---- | 0039 |         for _, amount in balance_effects(tx, today):
+ ---- | 0040 |             balance += amount
+ ---- | 0041 |     return balance
+ ---- | 0042 | 
+ ---- | 0043 | 
= 0034 | 0044 | async def _state_map(user_id: str) -> dict:
- 0035 | ---- |     docs=await db.radar_states.find({"user_id":user_id}).to_list(5000)
- 0036 | ---- |     return {d["signal_id"]:d for d in docs}
+ ---- | 0045 |     docs = await db.radar_states.find({'user_id': user_id}).to_list(5000)
+ ---- | 0046 |     return {d['signal_id']: d for d in docs}
= 0037 | 0047 | 
= 0038 | 0048 | async def _signals(user_id: str) -> list[dict]:
- 0039 | ---- |     today=date.fromisoformat(today_iso()); today_s=today.isoformat(); month=today_s[:7]
- 0040 | ---- |     start90=(today-timedelta(days=90)).isoformat()
- 0041 | ---- |     txs=await db.transactions.find({"user_id":user_id}).to_list(20000)
- 0042 | ---- |     cats=await db.categories.find({"user_id":user_id}).to_list(500)
- 0043 | ---- |     cat_by_id={c["id"]:c for c in cats}
- 0044 | ---- |     signals=[]
- 0045 | ---- | 
- 0046 | ---- |     # 90-day personal baseline: category daily pace and individual purchase size.
- 0047 | ---- |     hist=[t for t in txs if t.get("type")=="despesa" and t.get("status")=="pago" and start90<=t["date"]<today_s]
- 0048 | ---- |     by_cat=defaultdict(list)
- 0049 | ---- |     current_cat=defaultdict(float)
+ ---- | 0049 |     today = date.fromisoformat(today_iso())
+ ---- | 0050 |     today_s = today.isoformat()
+ ---- | 0051 |     month = today_s[:7]
+ ---- | 0052 |     start90 = (today - timedelta(days=90)).isoformat()
+ ---- | 0053 |     txs = await db.transactions.find({'user_id': user_id}).to_list(20000)
+ ---- | 0054 |     cats = await db.categories.find({'user_id': user_id}).to_list(500)
+ ---- | 0055 |     cat_by_id = {c['id']: c for c in cats}
+ ---- | 0056 |     signals = []
+ ---- | 0057 |     hist = [t for t in txs if t.get('type') == 'despesa' and t.get('status') == 'pago' and (start90 <= t['date'] < today_s)]
+ ---- | 0058 |     by_cat = defaultdict(list)
+ ---- | 0059 |     current_cat = defaultdict(D)
= 0050 | 0060 |     for t in hist:
- 0051 | ---- |         if t.get("category_id"): by_cat[t["category_id"]].append(float(t.get("adjusted_value") or t["value"]))
+ ---- | 0061 |         if t.get('category_id'):
+ ---- | 0062 |             by_cat[t['category_id']].append(D(t.get('adjusted_value') or t['value']))
= 0052 | 0063 |     for t in txs:
- 0053 | ---- |         if t.get("type")=="despesa" and t.get("status")=="pago" and t["date"].startswith(month) and t.get("category_id"):
- 0054 | ---- |             p=month_portion(t,month)
- 0055 | ---- |             if p is not None: current_cat[t["category_id"]]+=p
- 0056 | ---- | 
- 0057 | ---- |     elapsed=max(today.day,1)
- 0058 | ---- |     for cid,current in current_cat.items():
- 0059 | ---- |         vals=by_cat.get(cid,[])
- 0060 | ---- |         cat=cat_by_id.get(cid,{})
- 0061 | ---- |         # Compare monthly pace against prior 90-day daily baseline.
- 0062 | ---- |         hist_total=sum(vals)
- 0063 | ---- |         hist_days=90
- 0064 | ---- |         expected=hist_total/hist_days*elapsed if hist_total else 0
- 0065 | ---- |         if expected>=50 and current>expected*1.25:
- 0066 | ---- |             pct=round((current/expected-1)*100)
- 0067 | ---- |             signals.append(dict(id=f"pace-{cid}-{month}",type="deviation",severity="high" if pct>=50 else "medium",
- 0068 | ---- |               title=f"{cat.get('name','Categoria')} está acima do seu padrão",description=f"+{pct}% em relação ao seu ritmo dos últimos 90 dias",
- 0069 | ---- |               explanation=f"Até hoje, seu padrão de 90 dias indicaria cerca de {brl(expected)}. Neste mês já foram {brl(current)}.",
- 0070 | ---- |               metric=f"+{pct}%",score=70+min(pct,80)/4,related_entity_type="category",related_entity_id=cid,
- 0071 | ---- |               expires_at=month_end(month),evidence=[{"label":"Esperado até hoje","value":brl(expected)},{"label":"Gasto atual","value":brl(current)},{"label":"Base analisada","value":"90 dias"}]))
- 0072 | ---- | 
- 0073 | ---- |         budget=float(cat.get("monthly_budget") or 0)
- 0074 | ---- |         if budget>0 and current/budget>=.85:
- 0075 | ---- |             pct=current/budget*100; critical=pct>=100
- 0076 | ---- |             signals.append(dict(id=f"budget-{cid}-{month}",type="risk",severity="critical" if critical else "high",
- 0077 | ---- |               title=f"{cat.get('name','Categoria')} {'passou' if critical else 'está perto'} do orçamento",
- 0078 | ---- |               description=f"{brl(current)} de {brl(budget)} planejados",explanation=f"Você já utilizou {pct:.0f}% do orçamento definido para esta categoria.",
- 0079 | ---- |               metric=f"{pct:.0f}%",score=98 if critical else 88,related_entity_type="category",related_entity_id=cid,
- 0080 | ---- |               expires_at=month_end(month),evidence=[{"label":"Orçamento","value":brl(budget)},{"label":"Utilizado","value":brl(current)}]))
- 0081 | ---- | 
- 0082 | ---- |     # Transaction anomalies vs personal category purchase size.
+ ---- | 0064 |         if t.get('type') == 'despesa' and t.get('status') == 'pago' and t['date'].startswith(month) and t.get('category_id'):
+ ---- | 0065 |             p = month_portion(t, month)
+ ---- | 0066 |             if p is not None:
+ ---- | 0067 |                 current_cat[t['category_id']] += p
+ ---- | 0068 |     elapsed = max(today.day, 1)
+ ---- | 0069 |     for (cid, current) in current_cat.items():
+ ---- | 0070 |         vals = by_cat.get(cid, [])
+ ---- | 0071 |         cat = cat_by_id.get(cid, {})
+ ---- | 0072 |         hist_total = sum(vals)
+ ---- | 0073 |         hist_days = 90
+ ---- | 0074 |         expected = hist_total / hist_days * elapsed if hist_total else 0
+ ---- | 0075 |         if expected >= 50 and current > expected * D('1.25'):
+ ---- | 0076 |             pct = round((current / expected - 1) * 100)
+ ---- | 0077 |             signals.append(dict(id=f'pace-{cid}-{month}', type='deviation', severity='high' if pct >= 50 else 'medium', title=f"{cat.get('name', 'Categoria')} está acima do seu padrão", description=f'+{pct}% em relação ao seu ritmo dos últimos 90 dias', explanation=f'Até hoje, seu padrão de 90 dias indicaria cerca de {brl(expected)}. Neste mês já foram {brl(current)}.', metric=f'+{pct}%', score=70 + min(pct, 80) / 4, related_entity_type='category', related_entity_id=cid, expires_at=month_end(month), evidence=[{'label': 'Esperado até hoje', 'value': brl(expected)}, {'label': 'Gasto atual', 'value': brl(current)}, {'label': 'Base analisada', 'value': '90 dias'}]))
+ ---- | 0078 |         budget = D(cat.get('monthly_budget') or 0)
+ ---- | 0079 |         if budget > 0 and current / budget >= D('0.85'):
+ ---- | 0080 |             pct = current / budget * 100
+ ---- | 0081 |             critical = pct >= 100
+ ---- | 0082 |             signals.append(dict(id=f'budget-{cid}-{month}', type='risk', severity='critical' if critical else 'high', title=f"{cat.get('name', 'Categoria')} {('passou' if critical else 'está perto')} do orçamento", description=f'{brl(current)} de {brl(budget)} planejados', explanation=f'Você já utilizou {pct:.0f}% do orçamento definido para esta categoria.', metric=f'{pct:.0f}%', score=98 if critical else 88, related_entity_type='category', related_entity_id=cid, expires_at=month_end(month), evidence=[{'label': 'Orçamento', 'value': brl(budget)}, {'label': 'Utilizado', 'value': brl(current)}]))
= 0083 | 0083 |     for t in txs:
- 0084 | ---- |         if t.get("type")!="despesa" or t.get("status")!="pago" or t["date"]< (today-timedelta(days=7)).isoformat(): continue
- 0085 | ---- |         vals=by_cat.get(t.get("category_id"),[])
- 0086 | ---- |         if len(vals)<5: continue
- 0087 | ---- |         avg=mean(vals); value=float(t.get("adjusted_value") or t["value"])
- 0088 | ---- |         if avg>=20 and value>=max(avg*2.5,avg+100):
- 0089 | ---- |             signals.append(dict(id=f"anomaly-{t['id']}",type="deviation",severity="high",title=f"Gasto fora do seu padrão: {t['name']}",
- 0090 | ---- |               description=f"{brl(value)} · sua média semelhante é {brl(avg)}",explanation="Este lançamento ficou muito acima do valor típico das suas compras nessa categoria nos últimos 90 dias.",
- 0091 | ---- |               metric=f"{value/avg:.1f}×",score=82,related_entity_type="transaction",related_entity_id=t["id"],expires_at=(today+timedelta(days=7)).isoformat(),
- 0092 | ---- |               evidence=[{"label":"Compra","value":brl(value)},{"label":"Média pessoal","value":brl(avg)}]))
- 0093 | ---- | 
- 0094 | ---- |     # Duplicate candidates: same normalized name/value/date.
- 0095 | ---- |     seen={}
- 0096 | ---- |     for t in sorted(hist,key=lambda x:x["date"],reverse=True):
- 0097 | ---- |         key=(t.get("name","").strip().lower(),round(float(t.get("adjusted_value") or t["value"]),2),t["date"])
+ ---- | 0084 |         if t.get('type') != 'despesa' or t.get('status') != 'pago' or t['date'] < (today - timedelta(days=7)).isoformat():
+ ---- | 0085 |             continue
+ ---- | 0086 |         vals = by_cat.get(t.get('category_id'), [])
+ ---- | 0087 |         if len(vals) < 5:
+ ---- | 0088 |             continue
+ ---- | 0089 |         avg = mean(vals)
+ ---- | 0090 |         value = D(t.get('adjusted_value') or t['value'])
+ ---- | 0091 |         if avg >= 20 and value >= max(avg * D('2.5'), avg + 100):
+ ---- | 0092 |             signals.append(dict(id=f"anomaly-{t['id']}", type='deviation', severity='high', title=f"Gasto fora do seu padrão: {t['name']}", description=f'{brl(value)} · sua média semelhante é {brl(avg)}', explanation='Este lançamento ficou muito acima do valor típico das suas compras nessa categoria nos últimos 90 dias.', metric=f'{value / avg:.1f}×', score=82, related_entity_type='transaction', related_entity_id=t['id'], expires_at=(today + timedelta(days=7)).isoformat(), evidence=[{'label': 'Compra', 'value': brl(value)}, {'label': 'Média pessoal', 'value': brl(avg)}]))
+ ---- | 0093 |     seen = {}
+ ---- | 0094 |     for t in sorted(hist, key=lambda x: x['date'], reverse=True):
+ ---- | 0095 |         key = (t.get('name', '').strip().lower(), round(D(t.get('adjusted_value') or t['value']), 2), t['date'])
= 0098 | 0096 |         if key in seen:
- 0099 | ---- |             signals.append(dict(id=f"duplicate-{t['id']}",type="risk",severity="high",title="Possível cobrança duplicada",
- 0100 | ---- |               description=f"{t['name']} aparece duas vezes por {brl(key[1])}",explanation="Encontramos dois lançamentos com mesmo nome, valor e data. Vale conferir antes de considerar ambos corretos.",
- 0101 | ---- |               metric=brl(key[1]),score=92,related_entity_type="transaction",related_entity_id=t["id"],expires_at=(today+timedelta(days=14)).isoformat(),
- 0102 | ---- |               evidence=[{"label":"Valor","value":brl(key[1])},{"label":"Data","value":t["date"]}]))
- 0103 | ---- |         seen[key]=t["id"]
- 0104 | ---- | 
- 0105 | ---- |     # Cards: pressure, closing and future installments. Historical invoice baseline
- 0106 | ---- |     # approximates the last 3 calendar months of card expenses.
- 0107 | ---- |     card_docs=await db.cards.find({"user_id":user_id,"active":True}).to_list(200)
- 0108 | ---- |     card_txs,accounts=await card_context(user_id)
+ ---- | 0097 |             signals.append(dict(id=f"duplicate-{t['id']}", type='risk', severity='high', title='Possível cobrança duplicada', description=f"{t['name']} aparece duas vezes por {brl(key[1])}", explanation='Encontramos dois lançamentos com mesmo nome, valor e data. Vale conferir antes de considerar ambos corretos.', metric=brl(key[1]), score=92, related_entity_type='transaction', related_entity_id=t['id'], expires_at=(today + timedelta(days=14)).isoformat(), evidence=[{'label': 'Valor', 'value': brl(key[1])}, {'label': 'Data', 'value': t['date']}]))
+ ---- | 0098 |         seen[key] = t['id']
+ ---- | 0099 |     card_docs = await db.cards.find({'user_id': user_id, 'active': True}).to_list(200)
+ ---- | 0100 |     (card_txs, accounts) = await card_context(user_id)
= 0109 | 0101 |     for doc in card_docs:
- 0110 | ---- |         card=await build_card(doc,card_txs,accounts); close=days_until(card.next_closing)
- 0111 | ---- |         monthly=[]
- 0112 | ---- |         for offset in (1,2,3):
- 0113 | ---- |             m=add_months(month,-offset)
- 0114 | ---- |             total=sum((month_portion(t,m) or 0) for t in card_txs if t.get("card_id")==card.id and t.get("type")=="despesa")
- 0115 | ---- |             if total>0: monthly.append(total)
- 0116 | ---- |         avg3=mean(monthly) if monthly else 0
- 0117 | ---- |         if avg3>=100 and card.current_invoice>avg3*1.15:
- 0118 | ---- |             pct=round((card.current_invoice/avg3-1)*100)
- 0119 | ---- |             signals.append(dict(id=f"card-trend-{card.id}-{card.next_closing}",type="risk",severity="critical" if pct>=35 else "high",
- 0120 | ---- |               title=f"Fatura {card.name} acima das últimas faturas",description=f"+{pct}% sobre a média recente",explanation=f"A fatura atual está em {brl(card.current_invoice)}; a média dos últimos {len(monthly)} meses foi {brl(avg3)}.",
- 0121 | ---- |               metric=f"+{pct}%",score=97 if pct>=35 else 89,related_entity_type="card",related_entity_id=card.id,expires_at=card.next_closing,
- 0122 | ---- |               evidence=[{"label":"Fatura atual","value":brl(card.current_invoice)},{"label":"Média recente","value":brl(avg3)}]))
- 0123 | ---- |         elif 0<=close<=4 and not card.invoice_paid:
- 0124 | ---- |             signals.append(dict(id=f"card-close-{card.id}-{card.next_closing}",type="information",severity="normal",title=f"Cartão {card.name} fecha em {close} dia{'s' if close!=1 else ''}",
- 0125 | ---- |               description="Compras novas em breve irão para a próxima fatura",explanation="O FINNOS acompanha o ciclo do cartão para você saber quando novas compras mudam de fatura.",
- 0126 | ---- |               score=50+(4-close)*2,related_entity_type="card",related_entity_id=card.id,expires_at=card.next_closing,evidence=[{"label":"Fatura atual","value":brl(card.current_invoice)}]))
- 0127 | ---- |         if card.future_installments>=500:
- 0128 | ---- |             signals.append(dict(id=f"future-{card.id}-{month}",type="information",severity="normal",title=f"{brl(card.future_installments)} já comprometidos no {card.name}",
- 0129 | ---- |               description="Parcelas futuras já ocupam parte do seu limite",explanation="Esse valor corresponde às parcelas que ainda chegarão nas próximas faturas.",
- 0130 | ---- |               metric=brl(card.future_installments),score=45,related_entity_type="card",related_entity_id=card.id,expires_at=month_end(month),
- 0131 | ---- |               evidence=[{"label":"Parcelas futuras","value":brl(card.future_installments)}]))
- 0132 | ---- | 
- 0133 | ---- |     # Overdue commitments: registered expenses that should already have been paid.
- 0134 | ---- |     overdue=[t for t in txs if t.get("type")=="despesa" and t.get("status") in ("pendente","agendado") and t.get("date","9999")<today_s]
- 0135 | ---- |     for t in sorted(overdue,key=lambda x:x.get("date",""))[:5]:
- 0136 | ---- |         value=float(t.get("adjusted_value") or t.get("value") or 0)
- 0137 | ---- |         late=(today-date.fromisoformat(t["date"])).days
- 0138 | ---- |         signals.append(dict(id=f"overdue-{t['id']}",type="risk",severity="critical" if late>=7 else "high",
- 0139 | ---- |           title=f"Pagamento em atraso: {t.get('name','Despesa')}",description=f"{brl(value)} venceu há {late} dia{'s' if late!=1 else ''}",
- 0140 | ---- |           explanation="Este compromisso está cadastrado como pendente ou agendado e a data prevista já passou. Confirme o pagamento ou revise o lançamento.",
- 0141 | ---- |           metric=brl(value),score=99 if late>=7 else 94,related_entity_type="transaction",related_entity_id=t["id"],
- 0142 | ---- |           expires_at=None,evidence=[{"label":"Vencimento","value":t["date"]},{"label":"Dias em atraso","value":str(late)},{"label":"Valor","value":brl(value)}]))
- 0143 | ---- | 
- 0144 | ---- |     # Cash-flow projection: paid balance plus pending/scheduled entries over 30 days.
- 0145 | ---- |     accounts=await db.accounts.find({"user_id":user_id}).to_list(500)
- 0146 | ---- |     balance=sum(float(a.get("initial_balance") or 0) for a in accounts)
- 0147 | ---- |     for t in txs:
- 0148 | ---- |         if t.get("status")=="pago" and t["date"]<=today_s:
- 0149 | ---- |             v=float(t.get("adjusted_value") or t["value"])
- 0150 | ---- |             if t["type"]=="receita": balance+=v
- 0151 | ---- |             elif t["type"]=="despesa": balance-=v
- 0152 | ---- |     projected=balance; negative_date=None
- 0153 | ---- |     future=sorted([t for t in txs if t.get("status") in ("pendente","agendado") and today_s<=t["date"]<=(today+timedelta(days=30)).isoformat()],key=lambda x:x["date"])
+ ---- | 0102 |         card = await build_card(doc, card_txs, accounts)
+ ---- | 0103 |         close = days_until(card.next_closing)
+ ---- | 0104 |         monthly = []
+ ---- | 0105 |         for offset in (1, 2, 3):
+ ---- | 0106 |             m = add_months(month, -offset)
+ ---- | 0107 |             total = sum((month_portion(t, m) or 0 for t in card_txs if t.get('card_id') == card.id and t.get('type') == 'despesa'))
+ ---- | 0108 |             if total > 0:
+ ---- | 0109 |                 monthly.append(total)
+ ---- | 0110 |         avg3 = mean(monthly) if monthly else 0
+ ---- | 0111 |         if avg3 >= 100 and card.current_invoice > avg3 * D('1.15'):
+ ---- | 0112 |             pct = round((card.current_invoice / avg3 - 1) * 100)
+ ---- | 0113 |             signals.append(dict(id=f'card-trend-{card.id}-{card.next_closing}', type='risk', severity='critical' if pct >= 35 else 'high', title=f'Fatura {card.name} acima das últimas faturas', description=f'+{pct}% sobre a média recente', explanation=f'A fatura atual está em {brl(card.current_invoice)}; a média dos últimos {len(monthly)} meses foi {brl(avg3)}.', metric=f'+{pct}%', score=97 if pct >= 35 else 89, related_entity_type='card', related_entity_id=card.id, expires_at=card.next_closing, evidence=[{'label': 'Fatura atual', 'value': brl(card.current_invoice)}, {'label': 'Média recente', 'value': brl(avg3)}]))
+ ---- | 0114 |         elif 0 <= close <= 4 and (not card.invoice_paid):
+ ---- | 0115 |             signals.append(dict(id=f'card-close-{card.id}-{card.next_closing}', type='information', severity='normal', title=f"Cartão {card.name} fecha em {close} dia{('s' if close != 1 else '')}", description='Compras novas em breve irão para a próxima fatura', explanation='O FINNOS acompanha o ciclo do cartão para você saber quando novas compras mudam de fatura.', score=50 + (4 - close) * 2, related_entity_type='card', related_entity_id=card.id, expires_at=card.next_closing, evidence=[{'label': 'Fatura atual', 'value': brl(card.current_invoice)}]))
+ ---- | 0116 |         if card.future_installments >= 500:
+ ---- | 0117 |             signals.append(dict(id=f'future-{card.id}-{month}', type='information', severity='normal', title=f'{brl(card.future_installments)} já comprometidos no {card.name}', description='Parcelas futuras já ocupam parte do seu limite', explanation='Esse valor corresponde às parcelas que ainda chegarão nas próximas faturas.', metric=brl(card.future_installments), score=45, related_entity_type='card', related_entity_id=card.id, expires_at=month_end(month), evidence=[{'label': 'Parcelas futuras', 'value': brl(card.future_installments)}]))
+ ---- | 0118 |     overdue = [t for t in txs if t.get('type') == 'despesa' and t.get('status') in ('pendente', 'agendado') and (t.get('date', '9999') < today_s)]
+ ---- | 0119 |     for t in sorted(overdue, key=lambda x: x.get('date', ''))[:5]:
+ ---- | 0120 |         value = D(t.get('adjusted_value') or t.get('value') or 0)
+ ---- | 0121 |         late = (today - date.fromisoformat(t['date'])).days
+ ---- | 0122 |         signals.append(dict(id=f"overdue-{t['id']}", type='risk', severity='critical' if late >= 7 else 'high', title=f"Pagamento em atraso: {t.get('name', 'Despesa')}", description=f"{brl(value)} venceu há {late} dia{('s' if late != 1 else '')}", explanation='Este compromisso está cadastrado como pendente ou agendado e a data prevista já passou. Confirme o pagamento ou revise o lançamento.', metric=brl(value), score=99 if late >= 7 else 94, related_entity_type='transaction', related_entity_id=t['id'], expires_at=None, evidence=[{'label': 'Vencimento', 'value': t['date']}, {'label': 'Dias em atraso', 'value': str(late)}, {'label': 'Valor', 'value': brl(value)}]))
+ ---- | 0123 |     accounts = await db.accounts.find({'user_id': user_id}).to_list(500)
+ ---- | 0124 |     balance = _settled_cash_balance(accounts, txs, today_s)
+ ---- | 0125 |     projected = balance
+ ---- | 0126 |     negative_date = None
+ ---- | 0127 |     future = sorted([t for t in txs if t.get('status') in ('pendente', 'agendado') and not t.get('card_id') and today_s <= t['date'] <= (today + timedelta(days=30)).isoformat()], key=lambda x: x['date'])
= 0154 | 0128 |     for t in future:
- 0155 | ---- |         v=float(t.get("adjusted_value") or t["value"])
- 0156 | ---- |         projected += v if t["type"]=="receita" else -v if t["type"]=="despesa" else 0
- 0157 | ---- |         if projected<0 and not negative_date: negative_date=t["date"]
+ ---- | 0129 |         v = D(t.get('adjusted_value') or t['value'])
+ ---- | 0130 |         projected += v if t['type'] == 'receita' else -v if t['type'] == 'despesa' else 0
+ ---- | 0131 |         if projected < 0 and (not negative_date):
+ ---- | 0132 |             negative_date = t['date']
= 0158 | 0133 |     if negative_date:
- 0159 | ---- |         signals.append(dict(id=f"cash-negative-{negative_date}",type="risk",severity="critical",title="Seu saldo projetado pode ficar negativo",
- 0160 | ---- |           description=f"Projeção indica saldo abaixo de zero em {negative_date[8:10]}/{negative_date[5:7]}",explanation="O FINNOS somou seu saldo atual aos lançamentos pendentes e agendados dos próximos 30 dias.",
- 0161 | ---- |           metric=brl(projected),score=100,related_entity_type="cashflow",expires_at=negative_date,evidence=[{"label":"Saldo atual","value":brl(balance)},{"label":"Projeção 30 dias","value":brl(projected)}]))
- 0162 | ---- |     elif future and projected>balance and projected>=200:
- 0163 | ---- |         signals.append(dict(id=f"cash-opportunity-{month}",type="opportunity",severity="normal",title="Sua projeção abre espaço para uma meta",
- 0164 | ---- |           description=f"Saldo projetado de {brl(projected)} nos próximos 30 dias",explanation="Considerando os lançamentos já programados, sua projeção permanece positiva. Você pode avaliar direcionar parte para uma meta.",
- 0165 | ---- |           metric=brl(projected),score=40,related_entity_type="cashflow",expires_at=(today+timedelta(days=7)).isoformat(),evidence=[{"label":"Projeção 30 dias","value":brl(projected)}]))
- 0166 | ---- | 
- 0167 | ---- |     # Recurrence detection: propose, never silently convert a transaction.
+ ---- | 0134 |         signals.append(dict(id=f'cash-negative-{negative_date}', type='risk', severity='critical', title='Seu saldo projetado pode ficar negativo', description=f'Projeção indica saldo abaixo de zero em {negative_date[8:10]}/{negative_date[5:7]}', explanation='O FINNOS somou seu saldo atual aos lançamentos pendentes e agendados dos próximos 30 dias.', metric=brl(projected), score=100, related_entity_type='cashflow', expires_at=negative_date, evidence=[{'label': 'Saldo atual', 'value': brl(balance)}, {'label': 'Projeção 30 dias', 'value': brl(projected)}]))
+ ---- | 0135 |     elif future and projected > balance and (projected >= 200):
+ ---- | 0136 |         signals.append(dict(id=f'cash-opportunity-{month}', type='opportunity', severity='normal', title='Sua projeção abre espaço para uma meta', description=f'Saldo projetado de {brl(projected)} nos próximos 30 dias', explanation='Considerando os lançamentos já programados, sua projeção permanece positiva. Você pode avaliar direcionar parte para uma meta.', metric=brl(projected), score=40, related_entity_type='cashflow', expires_at=(today + timedelta(days=7)).isoformat(), evidence=[{'label': 'Projeção 30 dias', 'value': brl(projected)}]))
= 0168 | 0137 |     signals.extend(await recurring_signals(user_id, month_end(month)))
- 0169 | ---- | 
- 0170 | ---- |     # Avoid a weaker pace signal when a category already has a budget risk.
- 0171 | ---- |     risky={s.get("related_entity_id") for s in signals if s["id"].startswith("budget-")}
- 0172 | ---- |     signals=[s for s in signals if not(s["id"].startswith("pace-") and s.get("related_entity_id") in risky)]
- 0173 | ---- |     states=await _state_map(user_id); out=[]
+ ---- | 0138 |     risky = {s.get('related_entity_id') for s in signals if s['id'].startswith('budget-')}
+ ---- | 0139 |     signals = [s for s in signals if not (s['id'].startswith('pace-') and s.get('related_entity_id') in risky)]
+ ---- | 0140 |     states = await _state_map(user_id)
+ ---- | 0141 |     out = []
= 0174 | 0142 |     for s in signals:
- 0175 | ---- |         st=states.get(s["id"],{})
- 0176 | ---- |         if st.get("state") in ("dismissed","resolved"): continue
- 0177 | ---- |         if st.get("dont_show_similar"): continue
- 0178 | ---- |         s["state"]=st.get("state","new"); s["detected_at"]=st.get("detected_at") or datetime.now(timezone.utc).isoformat()
+ ---- | 0143 |         st = states.get(s['id'], {})
+ ---- | 0144 |         if st.get('state') in ('dismissed', 'resolved'):
+ ---- | 0145 |             continue
+ ---- | 0146 |         if st.get('dont_show_similar'):
+ ---- | 0147 |             continue
+ ---- | 0148 |         s['state'] = st.get('state', 'new')
+ ---- | 0149 |         s['detected_at'] = st.get('detected_at') or datetime.now(timezone.utc).isoformat()
= 0179 | 0150 |         out.append(s)
- 0180 | ---- |     out.sort(key=lambda s:(-s["score"],s["id"]))
- 0181 | ---- |     for i,s in enumerate(out): s["radar_position"]=POSITIONS[i%len(POSITIONS)]
+ ---- | 0151 |     out.sort(key=lambda s: (-s['score'], s['id']))
+ ---- | 0152 |     for (i, s) in enumerate(out):
+ ---- | 0153 |         s['radar_position'] = POSITIONS[i % len(POSITIONS)]
= 0182 | 0154 |     return out
= 0183 | 0155 | 
- 0184 | ---- | @router.get("",response_model=RadarOut)
- 0185 | ---- | async def radar(user:dict=Depends(require_user))->RadarOut:
- 0186 | ---- |     items=[RadarSignalOut(**s) for s in await _signals(user["id"])]
- 0187 | ---- |     return RadarOut(items=items,count=len(items),active_count=len(items))
+ ---- | 0156 | @router.get('', response_model=RadarOut)
+ ---- | 0157 | async def radar(user: dict=Depends(require_user)) -> RadarOut:
+ ---- | 0158 |     items = [RadarSignalOut(**s) for s in await _signals(user['id'])]
+ ---- | 0159 |     return RadarOut(items=items, count=len(items), active_count=len(items))
= 0188 | 0160 | 
- 0189 | ---- | @router.post("/{signal_id}/action")
- 0190 | ---- | async def radar_action(signal_id:str,payload:RadarActionIn,user:dict=Depends(require_user)):
- 0191 | ---- |     state={"view":"viewed","dismiss":"dismissed","resolve":"resolved"}[payload.action]
- 0192 | ---- |     await db.radar_states.update_one({"user_id":user["id"],"signal_id":signal_id},{"$set":{"state":state,"updated_at":datetime.now(timezone.utc)},"$setOnInsert":{"detected_at":datetime.now(timezone.utc)}},upsert=True)
- 0193 | ---- |     return {"ok":True,"state":state}
+ ---- | 0161 | @router.post('/{signal_id}/action')
+ ---- | 0162 | async def radar_action(signal_id: str, payload: RadarActionIn, user: dict=Depends(require_user)):
+ ---- | 0163 |     state = {'view': 'viewed', 'dismiss': 'dismissed', 'resolve': 'resolved'}[payload.action]
+ ---- | 0164 |     await db.radar_states.update_one({'user_id': user['id'], 'signal_id': signal_id}, {'$set': {'state': state, 'updated_at': datetime.now(timezone.utc)}, '$setOnInsert': {'detected_at': datetime.now(timezone.utc)}}, upsert=True)
+ ---- | 0165 |     return {'ok': True, 'state': state}
= 0194 | 0166 | 
- 0195 | ---- | @router.post("/{signal_id}/feedback")
- 0196 | ---- | async def radar_feedback(signal_id:str,payload:RadarFeedbackIn,user:dict=Depends(require_user)):
- 0197 | ---- |     doc={"id":str(uuid.uuid4()),"user_id":user["id"],"signal_id":signal_id,"feedback":payload.feedback,"note":payload.note,"created_at":datetime.now(timezone.utc)}
+ ---- | 0167 | @router.post('/{signal_id}/feedback')
+ ---- | 0168 | async def radar_feedback(signal_id: str, payload: RadarFeedbackIn, user: dict=Depends(require_user)):
+ ---- | 0169 |     doc = {'id': str(uuid.uuid4()), 'user_id': user['id'], 'signal_id': signal_id, 'feedback': payload.feedback, 'note': payload.note, 'created_at': datetime.now(timezone.utc)}
= 0198 | 0170 |     await db.radar_feedback.insert_one(doc)
- 0199 | ---- |     update={"last_feedback":payload.feedback,"updated_at":datetime.now(timezone.utc)}
- 0200 | ---- |     if payload.feedback=="dont_show_similar": update["dont_show_similar"]=True
- 0201 | ---- |     await db.radar_states.update_one({"user_id":user["id"],"signal_id":signal_id},{"$set":update,"$setOnInsert":{"detected_at":datetime.now(timezone.utc)}},upsert=True)
- 0202 | ---- |     return {"ok":True}
+ ---- | 0171 |     update = {'last_feedback': payload.feedback, 'updated_at': datetime.now(timezone.utc)}
+ ---- | 0172 |     if payload.feedback == 'dont_show_similar':
+ ---- | 0173 |         update['dont_show_similar'] = True
+ ---- | 0174 |     await db.radar_states.update_one({'user_id': user['id'], 'signal_id': signal_id}, {'$set': update, '$setOnInsert': {'detected_at': datetime.now(timezone.utc)}}, upsert=True)
+ ---- | 0175 |     return {'ok': True}
= 0203 | 0176 | 
```


## backend/routers/ai.py ↔ frontend/finnos/routers/ai.py

Linhas legado 101; ativo 108.

```text
L---- | F---- | código
= 0001 | 0001 | """FINNOS IA — answers financial questions using the user's OWN provider key."""
= 0002 | 0002 | 
= 0003 | 0003 | from datetime import datetime, timezone
= 0004 | 0004 | from typing import List
+ ---- | 0005 | import os
= 0005 | 0006 | 
= 0006 | 0007 | from fastapi import APIRouter, Depends, HTTPException
= 0007 | 0008 | 
- 0008 | ---- | from lib.ai_context import build_financial_context
- 0009 | ---- | from lib.crypto import decrypt_secret, encrypt_secret, mask_secret
- 0010 | ---- | from lib.db import db
- 0011 | ---- | from lib.llm import PROVIDERS, ProviderError, call_llm, resolve_model, verify_key
- 0012 | ---- | from models.ai import AiAnswerOut, AiAskIn, AiKeyIn, AiKeyOut, AiProviderInfo
- 0013 | ---- | from routers.auth import require_user
+ ---- | 0009 | from finnos.lib.ai_context import build_financial_context
+ ---- | 0010 | from finnos.lib.crypto import decrypt_secret, encrypt_secret, mask_secret
+ ---- | 0011 | from finnos.lib.db import db
+ ---- | 0012 | from finnos.lib.llm import PROVIDERS, ProviderError, call_llm, resolve_model, verify_key
+ ---- | 0013 | from finnos.models.ai import AiAnswerOut, AiAskIn, AiKeyIn, AiKeyOut, AiProviderInfo
+ ---- | 0014 | from finnos.routers.auth import require_user
= 0014 | 0015 | 
= 0015 | 0016 | router = APIRouter(prefix="/ai", tags=["ai"])
= 0016 | 0017 | 
= 0017 | 0018 | 
= 0018 | 0019 | @router.get("/providers", response_model=List[AiProviderInfo])
= 0019 | 0020 | async def list_providers() -> list[AiProviderInfo]:
= 0020 | 0021 |     return [
= 0021 | 0022 |         AiProviderInfo(
= 0022 | 0023 |             provider=key,  # type: ignore[arg-type]
= 0023 | 0024 |             label=meta["label"],
= 0024 | 0025 |             default_model=meta["default_model"],
= 0025 | 0026 |             models=meta["models"],
= 0026 | 0027 |             console_url=meta["console_url"],
= 0027 | 0028 |         )
= 0028 | 0029 |         for key, meta in PROVIDERS.items()
= 0029 | 0030 |     ]
= 0030 | 0031 | 
= 0031 | 0032 | 
= 0032 | 0033 | @router.get("/keys", response_model=List[AiKeyOut])
= 0033 | 0034 | async def list_keys(user: dict = Depends(require_user)) -> list[AiKeyOut]:
- 0034 | ---- |     docs = await db.ai_keys.find({"user_id": user["id"]}, {"ciphertext": 0, "_id": 0}).to_list(10)
+ ---- | 0035 |     docs = await db.ai_keys.find({"user_id": user["id"]}).to_list(10)
= 0035 | 0036 |     return [AiKeyOut(provider=d["provider"], masked=d["masked"], model=d["model"]) for d in docs]
= 0036 | 0037 | 
= 0037 | 0038 | 
= 0038 | 0039 | @router.put("/keys", response_model=AiKeyOut)
= 0039 | 0040 | async def save_key(payload: AiKeyIn, user: dict = Depends(require_user)) -> AiKeyOut:
+ ---- | 0041 |     from finnos.lib.crypto import configured
+ ---- | 0042 |     if not configured(): raise HTTPException(503, "Criptografia de chaves não configurada neste ambiente.")
+ ---- | 0043 |     if os.getenv("FINNOS_AI_PAID_CALLS_ENABLED") != "1":
+ ---- | 0044 |         raise HTTPException(503, "Chamadas pagas de IA aguardam autorização neste ambiente.")
= 0040 | 0045 |     raw = payload.key.get_secret_value().strip()
= 0041 | 0046 |     model = resolve_model(payload.provider, payload.model)
= 0042 | 0047 |     try:
= 0043 | 0048 |         await verify_key(provider=payload.provider, user_key=raw, model=model)
= 0044 | 0049 |     except ProviderError as exc:
= 0045 | 0050 |         raise HTTPException(status_code=exc.status, detail=exc.message) from exc
= 0046 | 0051 | 
= 0047 | 0052 |     await db.ai_keys.update_one(
= 0048 | 0053 |         {"user_id": user["id"], "provider": payload.provider},
= 0049 | 0054 |         {
= 0050 | 0055 |             "$set": {
= 0051 | 0056 |                 "ciphertext": encrypt_secret(raw),
= 0052 | 0057 |                 "masked": mask_secret(raw),
= 0053 | 0058 |                 "model": model,
= 0054 | 0059 |                 "updated_at": datetime.now(timezone.utc),
= 0055 | 0060 |             }
= 0056 | 0061 |         },
= 0057 | 0062 |         upsert=True,
= 0058 | 0063 |     )
= 0059 | 0064 |     return AiKeyOut(provider=payload.provider, masked=mask_secret(raw), model=model)
= 0060 | 0065 | 
= 0061 | 0066 | 
= 0062 | 0067 | @router.delete("/keys/{provider}", status_code=204)
= 0063 | 0068 | async def delete_key(provider: str, user: dict = Depends(require_user)) -> None:
= 0064 | 0069 |     if provider not in PROVIDERS:
= 0065 | 0070 |         raise HTTPException(status_code=404, detail="Provedor desconhecido.")
= 0066 | 0071 |     result = await db.ai_keys.delete_one({"user_id": user["id"], "provider": provider})
= 0067 | 0072 |     if not result.deleted_count:
= 0068 | 0073 |         raise HTTPException(status_code=404, detail="Nenhuma chave cadastrada para este provedor.")
= 0069 | 0074 | 
= 0070 | 0075 | 
= 0071 | 0076 | @router.post("/ask", response_model=AiAnswerOut)
= 0072 | 0077 | async def ask(payload: AiAskIn, user: dict = Depends(require_user)) -> AiAnswerOut:
+ ---- | 0078 |     if os.getenv("FINNOS_AI_PAID_CALLS_ENABLED") != "1":
+ ---- | 0079 |         raise HTTPException(503, "Chamadas pagas de IA aguardam autorização neste ambiente.")
= 0073 | 0080 |     doc = await db.ai_keys.find_one({"user_id": user["id"], "provider": payload.provider})
= 0074 | 0081 |     if not doc:
= 0075 | 0082 |         raise HTTPException(
= 0076 | 0083 |             status_code=400,
= 0077 | 0084 |             detail="Cadastre sua chave deste provedor em Configurações para usar a IA.",
= 0078 | 0085 |         )
= 0079 | 0086 |     try:
= 0080 | 0087 |         user_key = decrypt_secret(doc["ciphertext"])
= 0081 | 0088 |     except ValueError as exc:
= 0082 | 0089 |         raise HTTPException(
= 0083 | 0090 |             status_code=400, detail="Não foi possível ler a chave salva. Cadastre-a novamente."
= 0084 | 0091 |         ) from exc
= 0085 | 0092 | 
= 0086 | 0093 |     model = resolve_model(payload.provider, doc.get("model"))
= 0087 | 0094 |     system_prompt = await build_financial_context(user["id"], payload.month)
= 0088 | 0095 |     try:
= 0089 | 0096 |         answer = await call_llm(
= 0090 | 0097 |             provider=payload.provider,
= 0091 | 0098 |             user_key=user_key,
= 0092 | 0099 |             model=model,
= 0093 | 0100 |             system_prompt=system_prompt,
= 0094 | 0101 |             question=payload.question.strip(),
= 0095 | 0102 |             history=[{"role": m.role, "content": m.content} for m in payload.history],
= 0096 | 0103 |         )
= 0097 | 0104 |     except ProviderError as exc:
= 0098 | 0105 |         raise HTTPException(status_code=exc.status, detail=exc.message) from exc
= 0099 | 0106 | 
= 0100 | 0107 |     return AiAnswerOut(answer=answer or "Não consegui gerar uma resposta agora.", provider=payload.provider, model=model)
= 0101 | 0108 | 
```


## backend/routers/auth.py ↔ frontend/finnos/routers/auth.py

Linhas legado 215; ativo 27.

```text
L---- | F---- | código
- 0001 | ---- | """Auth: signup with e-mail confirmation code, login, logout, me.
- 0002 | ---- | 
- 0003 | ---- | Signup creates an unverified user and e-mails a 6-digit code; the session only
- 0004 | ---- | opens after the code is confirmed. Sessions are httpOnly cookies, never JSON tokens.
- 0005 | ---- | """
- 0006 | ---- | 
- 0007 | ---- | import secrets
- 0008 | ---- | import uuid
- 0009 | ---- | from datetime import datetime, timedelta, timezone
- 0010 | ---- | 
- 0011 | ---- | from fastapi import APIRouter, Depends, HTTPException, Request, Response
- 0012 | ---- | from passlib.context import CryptContext
- 0013 | ---- | 
- 0014 | ---- | from lib.db import db
- 0015 | ---- | from lib.demo_data import insert_default_categories
- 0016 | ---- | from lib.email import send_email, verification_code_html
- 0017 | ---- | from lib.firebase import verify_id_token
- 0018 | ---- | from lib.stats import aware
- 0019 | ---- | from models.auth import (
- 0020 | ---- |     LoginIn,
- 0021 | ---- |     NameUpdateIn,
- 0022 | ---- |     ResendCodeIn,
- 0023 | ---- |     SignupIn,
- 0024 | ---- |     SignupOut,
- 0025 | ---- |     UserOut,
- 0026 | ---- |     VerifyEmailIn,
- 0027 | ---- | )
- 0028 | ---- | 
- 0029 | ---- | router = APIRouter(prefix="/auth", tags=["auth"])
- 0030 | ---- | 
- 0031 | ---- | pwd_context = CryptContext(schemes=["pbkdf2_sha256"])
- 0032 | ---- | SESSION_COOKIE = "finnos_session"
- 0033 | ---- | SESSION_TTL = timedelta(days=30)
- 0034 | ---- | CODE_TTL = timedelta(minutes=15)
- 0035 | ---- | MAX_CODE_ATTEMPTS = 5
- 0036 | ---- | RESEND_COOLDOWN = timedelta(seconds=60)
- 0037 | ---- | 
- 0038 | ---- | 
- 0039 | ---- | def _now() -> datetime:
- 0040 | ---- |     return datetime.now(timezone.utc)
- 0041 | ---- | 
- 0042 | ---- | 
- 0043 | ---- | async def require_user(request: Request) -> dict:
- 0044 | ---- |     """Dependency: the signed-in (and verified) user, or 401."""
- 0045 | ---- |     token = request.cookies.get(SESSION_COOKIE)
- 0046 | ---- |     if token:
- 0047 | ---- |         session = await db.sessions.find_one({"token": token, "expires_at": {"$gte": _now()}})
- 0048 | ---- |         if session:
- 0049 | ---- |             user = await db.users.find_one({"id": session["user_id"]})
- 0050 | ---- |             if user and user.get("email_verified"):
- 0051 | ---- |                 return user
- 0052 | ---- |     raise HTTPException(status_code=401, detail="Não autenticado. Entre novamente.")
- 0053 | ---- | 
- 0054 | ---- | 
- 0055 | ---- | def _user_out(doc: dict) -> UserOut:
- 0056 | ---- |     return UserOut(
- 0057 | ---- |         id=doc["id"],
- 0058 | ---- |         name=doc["name"],
- 0059 | ---- |         email=doc["email"],
- 0060 | ---- |         created_at=aware(doc.get("created_at")) or _now(),
- 0061 | ---- |     )
- 0062 | ---- | 
- 0063 | ---- | 
- 0064 | ---- | async def _open_session(response: Response, user_id: str) -> None:
- 0065 | ---- |     token = str(uuid.uuid4())
- 0066 | ---- |     await db.sessions.insert_one(
- 0067 | ---- |         {"token": token, "user_id": user_id, "created_at": _now(), "expires_at": _now() + SESSION_TTL}
- 0068 | ---- |     )
- 0069 | ---- |     response.set_cookie(
- 0070 | ---- |         SESSION_COOKIE,
- 0071 | ---- |         token,
- 0072 | ---- |         max_age=int(SESSION_TTL.total_seconds()),
- 0073 | ---- |         httponly=True,
- 0074 | ---- |         samesite="lax",
- 0075 | ---- |         path="/",
- 0076 | ---- |     )
- 0077 | ---- | 
- 0078 | ---- | 
- 0079 | ---- | async def _issue_code(user: dict) -> None:
- 0080 | ---- |     """Store a fresh hashed code and e-mail it. The plaintext code only lives in the e-mail."""
- 0081 | ---- |     code = f"{secrets.randbelow(1_000_000):06d}"
- 0082 | ---- |     await db.users.update_one(
- 0083 | ---- |         {"id": user["id"]},
- 0084 | ---- |         {
- 0085 | ---- |             "$set": {
- 0086 | ---- |                 "verification_code_hash": pwd_context.hash(code),
- 0087 | ---- |                 "verification_expires_at": _now() + CODE_TTL,
- 0088 | ---- |                 "verification_attempts": 0,
- 0089 | ---- |                 "verification_sent_at": _now(),
- 0090 | ---- |             }
- 0091 | ---- |         },
- 0092 | ---- |     )
- 0093 | ---- |     await send_email(
- 0094 | ---- |         to=user["email"],
- 0095 | ---- |         subject="Seu código de confirmação FINNOS",
- 0096 | ---- |         html=verification_code_html(name=user["name"], code=code),
- 0097 | ---- |     )
+ ---- | 0001 | from fastapi import HTTPException, Request
+ ---- | 0002 | from finnos.lib.db import active_uid
= 0098 | 0003 | 
+ ---- | 0004 | verify = None
+ ---- | 0005 | COOKIE = "finnos_firebase_session"
= 0099 | 0006 | 
- 0100 | ---- | @router.post("/signup", response_model=SignupOut, status_code=202)
- 0101 | ---- | async def signup(payload: SignupIn) -> SignupOut:
- 0102 | ---- |     email = payload.email.strip().lower()
- 0103 | ---- |     existing = await db.users.find_one({"email": email})
- 0104 | ---- |     if existing and existing.get("email_verified"):
- 0105 | ---- |         raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.")
= 0106 | 0007 | 
- 0107 | ---- |     if existing:
- 0108 | ---- |         # Unverified signup attempt: refresh credentials and send a new code.
- 0109 | ---- |         await db.users.update_one(
- 0110 | ---- |             {"id": existing["id"]},
- 0111 | ---- |             {"$set": {"name": payload.name.strip(), "password_hash": pwd_context.hash(payload.password)}},
- 0112 | ---- |         )
- 0113 | ---- |         user = {**existing, "name": payload.name.strip()}
+ ---- | 0008 | async def require_user(request: Request):
+ ---- | 0009 |     cookie = request.cookies.get(COOKIE)
+ ---- | 0010 |     scheme, _, token = request.headers.get("authorization", "").partition(" ")
+ ---- | 0011 |     if scheme.lower() == "bearer" and token.strip():
+ ---- | 0012 |         claims = verify(token.strip(), session=False)
+ ---- | 0013 |     elif cookie:
+ ---- | 0014 |         claims = verify(cookie, session=True)
= 0114 | 0015 |     else:
- 0115 | ---- |         user = {
- 0116 | ---- |             "id": str(uuid.uuid4()),
- 0117 | ---- |             "name": payload.name.strip(),
- 0118 | ---- |             "email": email,
- 0119 | ---- |             "password_hash": pwd_context.hash(payload.password),
- 0120 | ---- |             "email_verified": False,
- 0121 | ---- |             "created_at": _now(),
- 0122 | ---- |         }
- 0123 | ---- |         await db.users.insert_one(user)
- 0124 | ---- | 
- 0125 | ---- |     await _issue_code(user)
- 0126 | ---- |     return SignupOut(email=email)
- 0127 | ---- | 
- 0128 | ---- | 
- 0129 | ---- | @router.post("/verify-email", response_model=UserOut)
- 0130 | ---- | async def verify_email(payload: VerifyEmailIn, response: Response) -> UserOut:
- 0131 | ---- |     email = payload.email.strip().lower()
- 0132 | ---- |     user = await db.users.find_one({"email": email})
- 0133 | ---- |     if not user:
- 0134 | ---- |         raise HTTPException(status_code=404, detail="Nenhum cadastro encontrado para este e-mail.")
- 0135 | ---- |     if user.get("email_verified"):
- 0136 | ---- |         raise HTTPException(status_code=409, detail="Este e-mail já foi confirmado. Faça login.")
- 0137 | ---- | 
- 0138 | ---- |     expires = aware(user.get("verification_expires_at"))
- 0139 | ---- |     if not user.get("verification_code_hash") or not expires or expires < _now():
- 0140 | ---- |         raise HTTPException(status_code=410, detail="O código expirou. Peça um novo código.")
- 0141 | ---- |     if int(user.get("verification_attempts") or 0) >= MAX_CODE_ATTEMPTS:
- 0142 | ---- |         raise HTTPException(status_code=429, detail="Muitas tentativas. Peça um novo código.")
- 0143 | ---- | 
- 0144 | ---- |     if not pwd_context.verify(payload.code, user["verification_code_hash"]):
- 0145 | ---- |         await db.users.update_one({"id": user["id"]}, {"$inc": {"verification_attempts": 1}})
- 0146 | ---- |         raise HTTPException(status_code=400, detail="Código incorreto. Confira o e-mail e tente novamente.")
- 0147 | ---- | 
- 0148 | ---- |     await db.users.update_one(
- 0149 | ---- |         {"id": user["id"]},
- 0150 | ---- |         {
- 0151 | ---- |             "$set": {"email_verified": True, "verified_at": _now()},
- 0152 | ---- |             "$unset": {
- 0153 | ---- |                 "verification_code_hash": "",
- 0154 | ---- |                 "verification_expires_at": "",
- 0155 | ---- |                 "verification_attempts": "",
- 0156 | ---- |             },
- 0157 | ---- |         },
- 0158 | ---- |     )
- 0159 | ---- |     if not await db.categories.count_documents({"user_id": user["id"]}):
- 0160 | ---- |         await insert_default_categories(user["id"])
- 0161 | ---- |     await _open_session(response, user["id"])
- 0162 | ---- |     return _user_out(user)
- 0163 | ---- | 
- 0164 | ---- | 
- 0165 | ---- | @router.post("/resend-code", response_model=SignupOut)
- 0166 | ---- | async def resend_code(payload: ResendCodeIn) -> SignupOut:
- 0167 | ---- |     email = payload.email.strip().lower()
- 0168 | ---- |     user = await db.users.find_one({"email": email})
- 0169 | ---- |     if not user:
- 0170 | ---- |         raise HTTPException(status_code=404, detail="Nenhum cadastro encontrado para este e-mail.")
- 0171 | ---- |     if user.get("email_verified"):
- 0172 | ---- |         raise HTTPException(status_code=409, detail="Este e-mail já foi confirmado. Faça login.")
- 0173 | ---- | 
- 0174 | ---- |     sent_at = aware(user.get("verification_sent_at"))
- 0175 | ---- |     if sent_at and _now() - sent_at < RESEND_COOLDOWN:
- 0176 | ---- |         wait = int((RESEND_COOLDOWN - (_now() - sent_at)).total_seconds()) + 1
- 0177 | ---- |         raise HTTPException(status_code=429, detail=f"Aguarde {wait}s para pedir um novo código.")
- 0178 | ---- | 
- 0179 | ---- |     await _issue_code(user)
- 0180 | ---- |     return SignupOut(email=email)
- 0181 | ---- | 
- 0182 | ---- | 
- 0183 | ---- | @router.post("/login", response_model=UserOut)
- 0184 | ---- | async def login(payload: LoginIn, response: Response) -> UserOut:
- 0185 | ---- |     email = payload.email.strip().lower()
- 0186 | ---- |     user = await db.users.find_one({"email": email})
- 0187 | ---- |     if not user or not pwd_context.verify(payload.password, user.get("password_hash", "")):
- 0188 | ---- |         raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
- 0189 | ---- |     if not user.get("email_verified"):
- 0190 | ---- |         raise HTTPException(
- 0191 | ---- |             status_code=403, detail="Confirme seu e-mail para entrar. Podemos enviar um novo código."
- 0192 | ---- |         )
- 0193 | ---- |     await _open_session(response, user["id"])
- 0194 | ---- |     return _user_out(user)
- 0195 | ---- | 
- 0196 | ---- | 
- 0197 | ---- | @router.post("/logout", status_code=204)
- 0198 | ---- | async def logout(request: Request, response: Response) -> None:
- 0199 | ---- |     token = request.cookies.get(SESSION_COOKIE)
- 0200 | ---- |     if token:
- 0201 | ---- |         await db.sessions.delete_one({"token": token})
- 0202 | ---- |     response.delete_cookie(SESSION_COOKIE, path="/")
- 0203 | ---- | 
- 0204 | ---- | 
- 0205 | ---- | @router.get("/me", response_model=UserOut)
- 0206 | ---- | async def me(user: dict = Depends(require_user)) -> UserOut:
- 0207 | ---- |     return _user_out(user)
- 0208 | ---- | 
- 0209 | ---- | 
- 0210 | ---- | @router.patch("/me", response_model=UserOut)
- 0211 | ---- | async def update_name(payload: NameUpdateIn, user: dict = Depends(require_user)) -> UserOut:
- 0212 | ---- |     await db.users.update_one({"id": user["id"]}, {"$set": {"name": payload.name, "updated_at": _now()}})
- 0213 | ---- |     user["name"] = payload.name
- 0214 | ---- |     return _user_out(user)
+ ---- | 0016 |         raise HTTPException(401, "Não autenticado.")
+ ---- | 0017 |     uid = claims["uid"]
+ ---- | 0018 |     if "/" in uid or len(uid) > 128:
+ ---- | 0019 |         raise HTTPException(401, "Identidade inválida.")
+ ---- | 0020 |     if (
+ ---- | 0021 |         request.headers.get("x-finnos-user-id")
+ ---- | 0022 |         and request.headers["x-finnos-user-id"] != uid
+ ---- | 0023 |     ):
+ ---- | 0024 |         raise HTTPException(401, "A identidade da sessão mudou.")
+ ---- | 0025 |     active_uid.set(uid)
+ ---- | 0026 |     return {"id": uid, "email": claims["email"]}
= 0215 | 0027 | 
```
