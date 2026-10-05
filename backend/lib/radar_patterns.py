"""Additional deterministic Radar patterns shared by account mode."""
from collections import defaultdict
from datetime import date
from statistics import mean

from lib.db import db
from lib.dates import today_iso


def _brl(value: float) -> str:
    raw=f"{value:,.2f}"
    return "R$ "+raw.replace(",","X").replace(".",",").replace("X",".")


async def recurring_signals(user_id: str, month_end: str) -> list[dict]:
    txs=await db.transactions.find({"user_id":user_id,"type":"despesa","status":"pago"}).to_list(20000)
    groups=defaultdict(list)
    for tx in txs:
        name=" ".join(str(tx.get("name") or "").lower().split())
        if name:
            groups[name].append(tx)
    out=[]
    for name,rows in groups.items():
        months={r["date"][:7] for r in rows if r.get("date")}
        if len(months)<3:
            continue
        rows=sorted(rows,key=lambda r:r["date"],reverse=True)
        recent=rows[0]
        values=[float(r.get("installment_value") or r.get("adjusted_value") or r.get("value") or 0) for r in rows]
        avg=mean(values) if values else 0
        slug="".join(ch for ch in name if ch.isalnum())[:32]
        out.append(dict(
            id=f"recurring-{slug}",
            type="information",severity="normal",
            title="Possível gasto recorrente",
            description=f"{recent.get('name','Despesa')} aparece em {len(months)} meses do seu histórico",
            explanation="O FINNOS encontrou repetição de estabelecimento e frequência mensal. Confirme antes de transformar isso em um compromisso recorrente.",
            metric=_brl(avg),score=68,
            related_entity_type="transaction",related_entity_id=recent.get("id"),
            expires_at=month_end,
            evidence=[{"label":"Ocorrências","value":str(len(rows))},{"label":"Meses encontrados","value":str(len(months))},{"label":"Valor médio","value":_brl(avg)}],
        ))
    return out
