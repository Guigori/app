import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, SlidersHorizontal, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { createBudgetCycle, fetchCategories, fetchCurrentBudgetCycle, fetchNextBudgetCycle, fetchBudgetSuggestion, updateBudgetCycle, type BudgetCyclePayload } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL } from "@/lib/format";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { BudgetMode, BudgetPeriod, BudgetPriority, Category } from "@/types/finnos";

type AllocationDraft={planned:string;priority:BudgetPriority;rollover:boolean};
const MODES:[BudgetMode,string,string][]=[["503020","Regra 50/30/20","Distribuição guiada entre necessidades, desejos e metas."],["personalizado","Personalizado","Você define quanto cada categoria recebe."]];
const PERIODS:[BudgetPeriod,string][]=[["semanal","Semanal"],["quinzenal","Quinzenal"],["mensal","Mensal"],["anual","Anual"]];

function iso(d:Date){return d.toISOString().slice(0,10)}
function defaultDates(period:BudgetPeriod,startRaw?:string){
 const s=startRaw?new Date(startRaw+"T12:00:00"):new Date(); const e=new Date(s);
 if(period==="semanal")e.setDate(e.getDate()+6);
 else if(period==="quinzenal")e.setDate(e.getDate()+14);
 else if(period==="mensal")e.setMonth(e.getMonth()+1,0);
 else e.setFullYear(e.getFullYear()+1),e.setDate(e.getDate()-1);
 return {start:iso(s),end:iso(e)};
}

export default function BudgetSettings(){
 const qc=useQueryClient();
 const current=useQuery({queryKey:["budget-v2-current"],queryFn:fetchCurrentBudgetCycle});
 const next=useQuery({queryKey:["budget-v2-next"],queryFn:fetchNextBudgetCycle});
 const cats=useQuery({queryKey:["categories"],queryFn:fetchCategories});
 const behavior=useQuery({queryKey:["budget-suggestion"],queryFn:fetchBudgetSuggestion});
 const [target,setTarget]=useState<"current"|"next">("current");
 const existing=target==="current"?current.data:next.data;
 const [mode,setMode]=useState<BudgetMode>("503020"),[period,setPeriod]=useState<BudgetPeriod>("mensal");
 const [start,setStart]=useState(""),[end,setEnd]=useState(""),[income,setIncome]=useState(""),[notes,setNotes]=useState("");
 const [extraordinary,setExtraordinary]=useState(false);
 const [alloc,setAlloc]=useState<Record<string,AllocationDraft>>({});

 useEffect(()=>{if(existing){setMode(existing.mode);setPeriod(existing.period);setStart(existing.start_date);setEnd(existing.end_date);setIncome(String(existing.expected_income||""));setNotes(existing.notes??"");setExtraordinary(existing.extraordinary);setAlloc(Object.fromEntries(existing.allocations.map(a=>[a.category_id,{planned:String(a.planned||""),priority:a.priority,rollover:a.rollover}])));}else{const d=defaultDates(period);setStart(d.start);setEnd(d.end);setIncome("");setNotes("");setExtraordinary(false);setAlloc({});}},[existing?.id,target]);
 useEffect(()=>{if(!existing){const d=defaultDates(period,start||undefined);setEnd(d.end)}},[period]);

 const categories=(cats.data??[]).filter(c=>c.name);
 const incomeNumber=Math.max(Number(income)||0,0);
 const suggested=useMemo(()=>({necessidades:incomeNumber*.5,desejos:incomeNumber*.3,metas:incomeNumber*.2}),[incomeNumber]);
 const groupCats=(group:string)=>categories.filter(c=>c.group===group);
 const getDraft=(c:Category):AllocationDraft=>alloc[c.id]??{planned:"",priority:c.group==="necessidades"?"essencial":c.group==="metas"?"meta":"flexivel",rollover:false};
 const plannedTotal=categories.reduce((sum,c)=>sum+(Number(getDraft(c).planned)||0),0);
 const setDraft=(id:string,patch:Partial<AllocationDraft>)=>setAlloc(prev=>{
  const current: AllocationDraft = prev[id] ?? { planned:"", priority:"flexivel", rollover:false };
  return {...prev,[id]:{...current,...patch}};
});
 const applyBehavior=()=>{
  const s=behavior.data;
  if(!s||!s.categories.length)return toast.error("Ainda não há histórico suficiente para sugerir um orçamento.");
  if(s.expected_income>0)setIncome(String(s.expected_income));
  const nextAlloc={...alloc};
  s.categories.forEach(item=>{
    const cat=categories.find(c=>c.id===item.category_id);
    if(!cat)return;
    nextAlloc[cat.id]={planned:item.suggested.toFixed(2),priority:cat.group==="necessidades"?"essencial":cat.group==="metas"?"meta":"flexivel",rollover:alloc[cat.id]?.rollover??false};
  });
  setAlloc(nextAlloc);setMode("personalizado");
  toast.success("Sugestão aplicada para revisão. Nada foi salvo ainda.");
 };
 const apply503020=()=>{if(!incomeNumber)return toast.error("Informe a renda prevista primeiro.");const nextAlloc={...alloc};(["necessidades","desejos","metas"] as const).forEach(g=>{const list=groupCats(g);const each=list.length?suggested[g]/list.length:0;list.forEach(c=>nextAlloc[c.id]={planned:each.toFixed(2),priority:g==="necessidades"?"essencial":g==="metas"?"meta":"flexivel",rollover:alloc[c.id]?.rollover??false});});setAlloc(nextAlloc);toast.success("50/30/20 distribuído entre as categorias. Você pode ajustar os valores.");};

 const save=useMutation({mutationFn:async()=>{if(!start||!end)throw new Error("Defina o período do ciclo.");const payload:BudgetCyclePayload={mode,period,start_date:start,end_date:end,expected_income:incomeNumber,extraordinary,notes:notes.trim()||null,allocations:categories.map(c=>{const d=getDraft(c);return{category_id:c.id,planned:Math.max(Number(d.planned)||0,0),priority:d.priority,rollover:d.rollover}}).filter(a=>a.planned>0)};return existing?updateBudgetCycle(existing.id,payload):createBudgetCycle(payload);},onSuccess:async()=>{toast.success(existing?"Orçamento atualizado.":"Orçamento criado.");await Promise.all([qc.invalidateQueries({queryKey:["budget-v2-current"]}),qc.invalidateQueries({queryKey:["budget-v2-next"]}),qc.invalidateQueries({queryKey:["budget-v2-history"]})]);},onError:e=>toast.error(e instanceof Error&&e.message.startsWith("Defina")?e.message:getApiErrorMessage(e))});

 return <div className="mx-auto max-w-4xl space-y-6 animate-fade-up">
  <div><Link to="/orcamento" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4"/> Voltar ao orçamento</Link><h1 className="font-heading text-2xl font-bold">Configurações do orçamento</h1><p className="mt-1 text-sm text-muted-foreground">Configure o planejamento sem poluir sua visão diária.</p></div>
  <div className="inline-flex rounded-xl bg-muted p-1">{([["current","Ciclo atual"],["next","Próximo ciclo"]] as const).map(([k,l])=><button key={k} onClick={()=>setTarget(k)} className={cn("rounded-lg px-4 py-2 text-sm font-medium",target===k?"bg-background shadow-sm":"text-muted-foreground")}>{l}</button>)}</div>
  <Card><CardHeader><CardTitle className="font-heading">Modelo e período</CardTitle><CardDescription>Mudar o modelo no próximo ciclo não altera seu histórico.</CardDescription></CardHeader><CardContent className="space-y-5">
   <div className="grid gap-3 sm:grid-cols-2">{MODES.map(([v,l,d])=><button type="button" key={v} onClick={()=>setMode(v)} className={cn("rounded-2xl border p-4 text-left transition-colors",mode===v?"border-primary bg-primary/5":"border-border hover:bg-muted/50")}><p className="font-semibold">{l}</p><p className="mt-1 text-xs text-muted-foreground">{d}</p></button>)}</div>
   <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>Periodicidade</Label><Select value={period} onValueChange={v=>setPeriod(v as BudgetPeriod)}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent>{PERIODS.map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Início</Label><Input type="date" value={start} onChange={e=>setStart(e.target.value)}/></div><div className="space-y-2"><Label>Fim</Label><Input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></div></div>
   <div className="space-y-2"><Label>Renda prevista no ciclo</Label><Input inputMode="decimal" value={income} onChange={e=>setIncome(e.target.value.replace(",", "."))} placeholder="0,00"/>{mode==="503020"&&incomeNumber>0?<p className="text-xs text-muted-foreground">Referência: {formatBRL(suggested.necessidades)} necessidades · {formatBRL(suggested.desejos)} desejos · {formatBRL(suggested.metas)} metas</p>:null}</div>
   {mode==="503020"?<Button type="button" variant="outline" onClick={apply503020}>Aplicar 50/30/20 às categorias</Button>:null}
  </CardContent></Card>
  <Card><CardHeader><CardTitle className="font-heading">Categorias e limites</CardTitle><CardDescription>Defina o valor planejado, a prioridade e se o saldo pode seguir para o próximo ciclo.</CardDescription></CardHeader><CardContent className="space-y-2">
   {categories.map(c=>{const d=getDraft(c);return <div key={c.id} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[minmax(150px,1fr)_130px_150px_auto] sm:items-center"><div className="flex min-w-0 items-center gap-2"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{backgroundColor:c.color+"1A",color:c.color}}><CategoryIcon name={c.icon} className="h-4 w-4"/></span><span className="truncate text-sm font-medium">{c.name}</span></div><Input inputMode="decimal" value={d.planned} onChange={e=>setDraft(c.id,{planned:e.target.value.replace(",",".")})} placeholder="R$ 0,00"/><Select value={d.priority} onValueChange={v=>setDraft(c.id,{priority:v as BudgetPriority})}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="essencial">Essencial</SelectItem><SelectItem value="flexivel">Flexível</SelectItem><SelectItem value="meta">Meta</SelectItem></SelectContent></Select><label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={d.rollover} onChange={e=>setDraft(c.id,{rollover:e.target.checked})} className="h-4 w-4 accent-primary"/> Rolar saldo</label></div>})}
   <div className="flex justify-between border-t border-border pt-4 text-sm"><span className="text-muted-foreground">Total planejado</span><strong>{formatBRL(plannedTotal)}</strong></div>
  </CardContent></Card>
  <Card><CardHeader><CardTitle className="flex items-center gap-2 font-heading"><SlidersHorizontal className="h-5 w-5 text-primary"/> Regras do ciclo</CardTitle></CardHeader><CardContent className="space-y-4"><label className="flex items-start gap-3 rounded-xl border border-border p-4"><input type="checkbox" checked={extraordinary} onChange={e=>setExtraordinary(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary"/><span><span className="block text-sm font-medium">Ciclo extraordinário</span><span className="text-xs text-muted-foreground">Use para períodos excepcionais, como viagem ou fim de ano, sem mudar seu padrão permanente.</span></span></label><div className="space-y-2"><Label>Observação</Label><Input value={notes} maxLength={500} onChange={e=>setNotes(e.target.value)} placeholder="Opcional"/></div></CardContent></Card>
  <div className="sticky bottom-4 flex justify-end"><Button size="lg" onClick={()=>save.mutate()} disabled={save.isPending||categories.length===0}><Save className="h-4 w-4"/>{save.isPending?"Salvando...":existing?"Salvar alterações":"Criar orçamento"}</Button></div>
 </div>
}