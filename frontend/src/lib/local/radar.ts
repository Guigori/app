import { addMonth, currentMonth, toLocalISO } from "@/lib/format";
import { localBudget, localDashboard, localListCards, localListTransactions } from "@/lib/local/engine";
import type { Radar, RadarSignal } from "@/types/finnos";

const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
const endOfMonth=(m:string)=>{const [y,mo]=m.split("-").map(Number);return `${m}-${String(new Date(y,mo,0).getDate()).padStart(2,"0")}`};
const signal=(x:Omit<RadarSignal,"radar_position"|"state"|"detected_at">):RadarSignal=>({...x,radar_position:0,state:"new",detected_at:new Date().toISOString()});

export function localRadar(): Radar {
  const month=currentMonth(), dashboard=localDashboard(month), budget=localBudget(month), txs=localListTransactions({});
  const today=new Date(), items:RadarSignal[]=[];
  const current=txs.filter(t=>t.type==="despesa"&&t.status==="pago"&&t.date.startsWith(month));
  const byName=new Map<string,typeof txs>();
  for(const tx of txs.filter(t=>t.type==="despesa"&&t.status==="pago")){
    const key=tx.name.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g," ");
    if(!key)continue;
    byName.set(key,[...(byName.get(key)??[]),tx]);
  }
  for(const [key,rows] of byName){
    const months=new Set(rows.map(r=>r.date.slice(0,7)));
    if(months.size<3)continue;
    const recent=[...rows].sort((a,b)=>b.date.localeCompare(a.date))[0];
    const avg=rows.reduce((s,r)=>s+(r.installment_value??r.value),0)/rows.length;
    items.push(signal({id:`recurring-${key.replace(/[^a-z0-9]/g,"").slice(0,24)}`,type:"information",severity:"normal",title:"Possível gasto recorrente",description:`${recent.name} aparece em ${months.size} meses do seu histórico`,explanation:"O FINNOS encontrou repetição de estabelecimento e frequência mensal. Confirme antes de transformar isso em um compromisso recorrente.",metric:money(avg),score:68,related_entity_type:"transaction",related_entity_id:recent.id,expires_at:endOfMonth(month),evidence:[{label:"Ocorrências",value:String(rows.length)},{label:"Meses encontrados",value:String(months.size)},{label:"Valor médio",value:money(avg)}]}));
  }
  for(const row of budget.rows.filter(r=>r.budget>0&&r.percent>=85)){
    items.push(signal({id:`budget-${row.category_id}-${month}`,type:"risk",severity:row.percent>=100?"critical":"high",title:`${row.name} ${row.percent>=100?"passou":"está perto"} do limite`,description:`${money(row.spent)} de ${money(row.budget)} planejados`,explanation:"O Radar compara o gasto confirmado com o limite definido para a categoria.",metric:`${Math.round(row.percent)}%`,score:row.percent>=100?98:88,related_entity_type:"category",related_entity_id:row.category_id,expires_at:endOfMonth(month),evidence:[{label:"Orçamento",value:money(row.budget)},{label:"Utilizado",value:money(row.spent)}]}));
  }
  for(const tx of txs.filter(t=>t.type==="despesa"&&(t.status==="pendente"||t.status==="agendado")&&t.date<toLocalISO(today)).slice(0,5)){
    const late=Math.max(1,Math.floor((today.getTime()-new Date(tx.date+"T12:00:00").getTime())/86400000));
    items.push(signal({id:`overdue-${tx.id}`,type:"risk",severity:late>=7?"critical":"high",title:`Pagamento em atraso: ${tx.name}`,description:`${money(tx.adjusted_value??tx.value)} venceu há ${late} dia${late===1?"":"s"}`,explanation:"Este compromisso está cadastrado como pendente ou agendado e a data prevista já passou. Confirme o pagamento ou revise o lançamento.",metric:money(tx.adjusted_value??tx.value),score:late>=7?99:94,related_entity_type:"transaction",related_entity_id:tx.id,expires_at:null,evidence:[{label:"Vencimento",value:tx.date},{label:"Dias em atraso",value:String(late)},{label:"Valor",value:money(tx.adjusted_value??tx.value)}]}));
  }
  const daysInMonth=new Date(today.getFullYear(),today.getMonth()+1,0).getDate(), remainingDays=Math.max(1,daysInMonth-today.getDate()+1);
  if(budget.remaining>0&&budget.planned>0){
    items.push(signal({id:`safe-spend-${month}`,type:"opportunity",severity:"normal",title:"Ritmo seguro até o fim do mês",description:`Você pode distribuir o orçamento restante pelos próximos ${remainingDays} dias`,explanation:"É uma referência de ritmo, não uma autorização para gastar: compromissos futuros ainda precisam ser considerados.",metric:`${money(budget.remaining/remainingDays)}/dia`,score:42,related_entity_type:"cashflow",related_entity_id:null,expires_at:endOfMonth(month),evidence:[{label:"Orçamento restante",value:money(budget.remaining)},{label:"Dias restantes",value:String(remainingDays)}]}));
  }
  // Same proactive alerts as the server Radar: invoice overdue / due soon, and the month's pace.
  const todayISO=toLocalISO(today), dayMs=86400000;
  for(const card of localListCards()){
    if(!card.payable_due||!(card.payable_invoice??0))continue;
    const days=Math.round((new Date(card.payable_due+"T12:00:00").getTime()-new Date(todayISO+"T12:00:00").getTime())/dayMs);
    const amount=money(card.payable_invoice??0);
    if(days<0)items.push(signal({id:`card-overdue-${card.id}-${card.payable_cycle}`,type:"risk",severity:"critical",title:`Fatura ${card.name} vencida`,description:`${amount} venceu há ${-days} dia${days===-1?"":"s"}`,explanation:"A fatura fechou e passou do vencimento sem pagamento registrado. Se você já pagou, registre o pagamento na fatura para o saldo e o limite ficarem corretos.",metric:amount,score:100,related_entity_type:"card",related_entity_id:card.id,expires_at:null,evidence:[{label:"Vencimento",value:card.payable_due},{label:"Dias em atraso",value:String(-days)},{label:"Valor em aberto",value:amount}]}));
    else if(days<=3)items.push(signal({id:`card-due-${card.id}-${card.payable_cycle}`,type:"risk",severity:"high",title:`Fatura ${card.name} vence ${days===0?"hoje":days===1?"amanhã":`em ${days} dias`}`,description:`${amount} a pagar até ${card.payable_due.slice(8,10)}/${card.payable_due.slice(5,7)}`,explanation:"A fatura já fechou e ainda não tem pagamento registrado. Pague (e registre o pagamento) para evitar juros e manter o limite correto.",metric:amount,score:96,related_entity_type:"card",related_entity_id:card.id,expires_at:card.payable_due,evidence:[{label:"Vencimento",value:card.payable_due},{label:"Valor",value:amount}]}));
  }
  const previous=localDashboard(addMonth(month,-1));
  if(today.getDate()>=7&&previous.expense>0&&today.getDate()<daysInMonth){
    const projected=dashboard.expense/today.getDate()*daysInMonth;
    if(projected>=previous.expense*1.15){
      const pct=Math.round((projected/previous.expense-1)*100);
      items.push(signal({id:`month-pace-${month}`,type:"deviation",severity:pct>=30?"high":"medium",title:"O mês está mais caro que o anterior",description:`No ritmo atual, as despesas fecham em ${money(projected)} (+${pct}%)`,explanation:`Até hoje foram ${money(dashboard.expense)} em ${today.getDate()} dias. Mantendo esse ritmo até o dia ${daysInMonth}, o mês passaria o anterior (${money(previous.expense)}).`,metric:`+${pct}%`,score:pct>=30?86:76,related_entity_type:"cashflow",related_entity_id:null,expires_at:endOfMonth(month),evidence:[{label:"Gasto até hoje",value:money(dashboard.expense)},{label:"Projeção do mês",value:money(projected)},{label:"Mês anterior",value:money(previous.expense)}]}));
    }
  }
  for(const card of localListCards()){
    const close=Math.ceil((new Date(card.next_closing+"T12:00:00").getTime()-today.getTime())/86400000);
    if(close>=0&&close<=5&&!card.invoice_paid)items.push(signal({id:`card-close-${card.id}-${card.next_closing}`,type:"information",severity:"normal",title:`Cartão ${card.name} fecha em ${close} dia${close===1?"":"s"}`,description:"Compras novas em breve irão para a próxima fatura",explanation:"O FINNOS acompanha o ciclo para mostrar o impacto temporal de uma compra.",metric:money(card.current_invoice),score:60,related_entity_type:"card",related_entity_id:card.id,expires_at:card.next_closing,evidence:[{label:"Fatura atual",value:money(card.current_invoice)},{label:"Limite disponível",value:money(card.available)}]}));
  }
  if(current.length&&dashboard.expense>dashboard.income&&dashboard.income>0)items.push(signal({id:`month-negative-${month}`,type:"risk",severity:"high",title:"As despesas já superam as receitas do mês",description:`${money(dashboard.expense)} em despesas para ${money(dashboard.income)} em receitas`,explanation:"O Radar compara apenas dados já registrados; receitas futuras não cadastradas não entram nessa leitura.",metric:money(dashboard.month_balance),score:90,related_entity_type:"cashflow",related_entity_id:null,expires_at:endOfMonth(month),evidence:[{label:"Receitas",value:money(dashboard.income)},{label:"Despesas",value:money(dashboard.expense)}]}));
  items.sort((a,b)=>b.score-a.score);
  const positions=[326,34,92,178,232,286,138];
  items.forEach((item,i)=>item.radar_position=positions[i%positions.length]);
  return {items:items.slice(0,12),count:items.length};
}
