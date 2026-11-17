import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScreenHeader } from "@/components/layout/BackButton";
import { Save, SlidersHorizontal, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createBudgetCycle, fetchCategories, fetchCurrentBudgetCycle, fetchNextBudgetCycle, fetchBudgetSuggestion, updateBudgetCycle, type BudgetCyclePayload } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, toLocalISO } from "@/lib/format";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ALERT_LABELS, splitLabel, useBudgetSettings, validSplit, type BudgetAlertKind, type BudgetModel, type BudgetSplit } from "@/lib/budget/prefs";
import type { BudgetMode, BudgetPeriod, BudgetPriority, Category } from "@/types/finnos";

type AllocationDraft={planned:string;priority:BudgetPriority;rollover:boolean};
const MODES:[BudgetMode,string,string][]=[["503020","Regra 50/30/20","Distribuição guiada entre necessidades, desejos e metas."],["personalizado","Personalizado","Você define quanto cada categoria recebe."]];
const PERIODS:[BudgetPeriod,string][]=[["semanal","Semanal"],["quinzenal","Quinzenal"],["mensal","Mensal"],["anual","Anual"]];

const iso=toLocalISO
function defaultDates(period:BudgetPeriod,startRaw?:string){
 const s=startRaw?new Date(startRaw+"T12:00:00"):new Date(); const e=new Date(s);
 if(period==="semanal")e.setDate(e.getDate()+6);
 else if(period==="quinzenal")e.setDate(e.getDate()+14);
 else if(period==="mensal")e.setMonth(e.getMonth()+1,0);
 else { e.setFullYear(e.getFullYear()+1); e.setDate(e.getDate()-1); }
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

 // Load the saved cycle into the form once per cycle id; refetches must not wipe edits.
 // oxlint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{if(existing){setMode(existing.mode);setPeriod(existing.period);setStart(existing.start_date);setEnd(existing.end_date);setIncome(String(existing.expected_income||""));setNotes(existing.notes??"");setExtraordinary(existing.extraordinary);setAlloc(Object.fromEntries(existing.allocations.map(a=>[a.category_id,{planned:String(a.planned||""),priority:a.priority,rollover:a.rollover}])));}else{const d=defaultDates(period);setStart(d.start);setEnd(d.end);setIncome("");setNotes("");setExtraordinary(false);setAlloc({});}},[existing?.id,target]);
 // Only a period change proposes a new end date; editing the start must not override it.
 // oxlint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{if(!existing){const d=defaultDates(period,start||undefined);setEnd(d.end)}},[period]);

 const categories=(cats.data??[]).filter(c=>c.name);
 const incomeNumber=Math.max(Number(income)||0,0);
 const suggested=useMemo(()=>({necessidades:incomeNumber*.5,desejos:incomeNumber*.3,metas:incomeNumber*.2}),[incomeNumber]);
 const groupCats=(group:string)=>categories.filter(c=>c.group===group);
 // Without a saved cycle, the form starts from the limits the Orçamento already uses (each category's monthly limit).
 const getDraft=(c:Category):AllocationDraft=>alloc[c.id]??{planned:!existing&&c.monthly_budget>0?String(c.monthly_budget):"",priority:c.group==="necessidades"?"essencial":c.group==="metas"?"meta":"flexivel",rollover:false};
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

 const [settings, setSettings] = useBudgetSettings();
 const [modelName, setModelName] = useState("");
 const [split, setSplit] = useState<BudgetSplit>(() => settings.split ?? { necessidades: 50, desejos: 30, futuro: 20 });
 const splitSum = split.necessidades + split.desejos + split.futuro;
 const saveModel = () => {
  const limits: Record<string, number> = Object.fromEntries(categories.map((c) => [c.id, Number(getDraft(c).planned) || 0] as [string, number]).filter(([, v]) => v > 0));
  if (!Object.keys(limits).length) return toast.error("Defina pelo menos um limite antes de salvar um modelo.");
  const name = modelName.trim() || `Modelo ${settings.models.length + 1}`;
  setSettings({ models: [...settings.models, { id: crypto.randomUUID(), name, note: `${Object.keys(limits).length} categorias · ${formatBRL(Object.values(limits).reduce((a, b) => a + b, 0))}`, limits, created_at: new Date().toISOString() }].slice(-12) });
  setModelName(""); toast.success(`Modelo “${name}” salvo.`);
 };
 const applyModel = (m: BudgetModel) => {
  const next = { ...alloc };
  categories.forEach((c) => { const v = m.limits[c.id]; const cur = getDraft(c); next[c.id] = { ...cur, planned: v ? String(v) : "" }; });
  setAlloc(next); setMode("personalizado"); toast.success(`Modelo “${m.name}” aplicado. Revise e salve.`);
 };
 return <div className="mx-auto max-w-[1240px] space-y-6 animate-fade-up">
  <ScreenHeader title="Configurar orçamento" subtitle="Limites, ciclo, colchão, avisos e modelos. O Orçamento só guarda isso." backLabel="Voltar ao orçamento" />
  <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
  <div className="min-w-0 space-y-6">
  <div className="inline-flex rounded-xl bg-muted p-1">{([["current","Ciclo atual"],["next","Próximo ciclo"]] as const).map(([k,l])=><button key={k} onClick={()=>setTarget(k)} className={cn("rounded-lg px-4 py-2 text-sm font-medium",target===k?"bg-background shadow-sm":"text-muted-foreground")}>{l}</button>)}</div>
  <Card><CardHeader><CardTitle className="font-heading">Modelo e período</CardTitle><CardDescription>Mudar o modelo no próximo ciclo não altera seu histórico.</CardDescription></CardHeader><CardContent className="space-y-5">
   <div className="grid gap-3 sm:grid-cols-2">{MODES.map(([v,l,d])=><button type="button" key={v} onClick={()=>setMode(v)} className={cn("rounded-2xl border p-4 text-left transition-colors",mode===v?"border-primary bg-primary/5":"border-border hover:bg-muted/50")}><p className="font-semibold">{l}</p><p className="mt-1 text-xs text-muted-foreground">{d}</p></button>)}</div>
   <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>Periodicidade</Label><Select value={period} onValueChange={v=>setPeriod(v as BudgetPeriod)}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent>{PERIODS.map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Início</Label><Input type="date" value={start} onChange={e=>setStart(e.target.value)}/></div><div className="space-y-2"><Label>Fim</Label><Input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></div></div>
   <div className="space-y-2"><Label>Renda prevista no ciclo</Label><Input inputMode="decimal" value={income} onChange={e=>setIncome(e.target.value.replace(",", "."))} placeholder="0,00"/>{mode==="503020"&&incomeNumber>0?<p className="text-xs text-muted-foreground">Referência: {formatBRL(suggested.necessidades)} necessidades · {formatBRL(suggested.desejos)} desejos · {formatBRL(suggested.metas)} metas</p>:null}</div>
   <div className="flex flex-wrap gap-2">
    {mode==="503020"?<Button type="button" variant="outline" onClick={apply503020}>Aplicar 50/30/20 às categorias</Button>:null}
    <Button type="button" variant="outline" onClick={applyBehavior} disabled={behavior.isPending||!behavior.data?.categories.length}><Sparkles className="h-4 w-4"/> Sugerir com meu histórico</Button>
   </div>
   {behavior.data?.categories.length?<p className="text-xs text-muted-foreground">A sugestão usa sua média recente e permanece como rascunho até você salvar.</p>:null}
  </CardContent></Card>
  <Card><CardHeader><CardTitle className="font-heading">Categorias e limites</CardTitle><CardDescription>Defina o valor planejado, a prioridade e se o saldo pode seguir para o próximo ciclo.</CardDescription></CardHeader><CardContent className="space-y-2">
   {categories.map(c=>{const d=getDraft(c);return <div key={c.id} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[minmax(150px,1fr)_130px_150px_auto] sm:items-center"><div className="flex min-w-0 items-center gap-2"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{backgroundColor:c.color+"1A",color:c.color}}><CategoryIcon name={c.icon} className="h-4 w-4"/></span><span className="truncate text-sm font-medium">{c.name}</span></div><Input inputMode="decimal" value={d.planned} onChange={e=>setDraft(c.id,{planned:e.target.value.replace(",",".")})} placeholder="R$ 0,00"/><Select value={d.priority} onValueChange={v=>setDraft(c.id,{priority:v as BudgetPriority})}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="essencial">Essencial</SelectItem><SelectItem value="flexivel">Flexível</SelectItem><SelectItem value="meta">Meta</SelectItem></SelectContent></Select><label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={d.rollover} onChange={e=>setDraft(c.id,{rollover:e.target.checked})} className="h-4 w-4 accent-primary"/> Rolar saldo</label></div>})}
   <div className="flex justify-between border-t border-border pt-4 text-sm"><span className="text-muted-foreground">Total planejado</span><strong>{formatBRL(plannedTotal)}</strong></div>
  </CardContent></Card>
  <Card><CardHeader><CardTitle className="flex items-center gap-2 font-heading"><SlidersHorizontal className="h-5 w-5 text-primary"/> Regras do ciclo</CardTitle></CardHeader><CardContent className="space-y-4"><label className="flex items-start gap-3 rounded-xl border border-border p-4"><input type="checkbox" checked={extraordinary} onChange={e=>setExtraordinary(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary"/><span><span className="block text-sm font-medium">Ciclo extraordinário</span><span className="text-xs text-muted-foreground">Use para períodos excepcionais, como viagem ou fim de ano, sem mudar seu padrão permanente.</span></span></label><div className="space-y-2"><Label>Observação</Label><Input value={notes} maxLength={500} onChange={e=>setNotes(e.target.value)} placeholder="Opcional"/></div></CardContent></Card>
  <div className="sticky bottom-4 flex justify-end"><Button size="lg" onClick={()=>save.mutate()} disabled={save.isPending||categories.length===0}><Save className="h-4 w-4"/>{save.isPending?"Salvando...":existing?"Salvar alterações":"Criar orçamento"}</Button></div>
  </div>
  <aside className="space-y-6 lg:sticky lg:top-4">
   <Card><CardHeader><CardTitle className="font-heading">O que o Orçamento guarda</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <p><strong>Guarda aqui:</strong> <span className="text-muted-foreground">limites por categoria, ciclo, colchão, avisos, modelos, o plano de cada mês e o retrato de cada fechamento.</span></p>
    <p><strong>Vem de outros lugares:</strong> <span className="text-muted-foreground">lançamentos e previstos do Fluxo, saldos e vales da Carteira, Assinaturas, Metas e datas. Quando uma tela daqui cria algo, quem salva é o módulo de origem.</span></p>
   </CardContent></Card>
   <Card data-testid="budget-cushion"><CardHeader><CardTitle className="font-heading">Colchão na conta</CardTitle><CardDescription>Um valor que fica sempre na conta e sai do livre para gastar. Não é meta.</CardDescription></CardHeader><CardContent className="space-y-3">
    <div className="flex flex-wrap gap-1.5">{[0,200,500,1000].map(v=><button key={v} type="button" onClick={()=>setSettings({cushion:v})} className={cn("h-8 rounded-full border px-3 text-xs font-semibold",settings.cushion===v?"border-primary bg-primary/10 text-primary":"border-border")}>{v?formatBRL(v):"Sem colchão"}</button>)}</div>
    <div className="flex items-center gap-2"><Label htmlFor="cushion" className="shrink-0 text-xs text-muted-foreground">Outro valor</Label><Input id="cushion" inputMode="decimal" className="h-8" value={settings.cushion?String(settings.cushion):""} placeholder="R$ 0" onChange={e=>setSettings({cushion:Math.max(0,Number(e.target.value.replace(",","."))||0)})}/></div>
   </CardContent></Card>
   <Card data-testid="budget-split"><CardHeader><CardTitle className="font-heading">Meu percentual</CardTitle><CardDescription>Como o 50/30/20, mas com a sua divisão do que entra. Vira uma opção em Criar novo período. A parte do futuro vai para metas, não é limite.</CardDescription></CardHeader><CardContent className="space-y-3">
    <div className="flex flex-wrap gap-1.5">{([[50,30,20],[55,25,20],[60,20,20],[50,25,25]] as const).map(([a,b,c])=><button key={`${a}${b}${c}`} type="button" onClick={()=>setSplit({necessidades:a,desejos:b,futuro:c})} className={cn("h-8 rounded-full border px-3 text-xs font-semibold",split.necessidades===a&&split.desejos===b&&split.futuro===c?"border-primary bg-primary/10 text-primary":"border-border")}>{a}/{b}/{c}</button>)}</div>
    <div className="grid grid-cols-3 gap-2">{([["necessidades","Necessidades"],["desejos","Desejos"],["futuro","Futuro (metas)"]] as const).map(([k,l])=><label key={k} className="grid gap-1 text-xs text-muted-foreground">{l}<span className="flex items-center gap-1"><Input inputMode="numeric" className="h-8" value={String(split[k])} onChange={e=>setSplit({...split,[k]:Math.max(0,Math.min(100,Math.round(Number(e.target.value.replace(/\D/g,""))||0)))})}/>%</span></label>)}</div>
    <p className={cn("text-xs",splitSum===100?"text-muted-foreground":"text-expense")}>{splitSum===100?(settings.split?`Salvo: ${splitLabel(settings.split)}.`:"Ainda não salvo."):`A soma está em ${splitSum}%: precisa dar 100%.`}</p>
    <div className="flex gap-2"><Button size="sm" disabled={!validSplit(split)} onClick={()=>{setSettings({split});toast.success(`Meu percentual: ${splitLabel(split)}.`);}}>Salvar percentual</Button>{settings.split?<Button size="sm" variant="ghost" onClick={()=>setSettings({split:null})}>Remover</Button>:null}</div>
   </CardContent></Card>
   <Card data-testid="finance-history-card"><CardHeader><CardTitle className="font-heading">Histórico financeiro</CardTitle><CardDescription>O registro de tudo o que foi cadastrado, alterado ou excluído: lançamentos, contas, cartões, categorias, metas e orçamento. Só para consulta.</CardDescription></CardHeader><CardContent>
    <Link to="/historico" className={cn(buttonVariants({variant:"outline",size:"sm"}),"rounded-full")} data-testid="finance-history-link">Abrir o histórico financeiro</Link>
   </CardContent></Card>
   <Card data-testid="budget-alerts-settings"><CardHeader><CardTitle className="font-heading">Avisos</CardTitle><CardDescription>Aparecem no Orçamento. Desligar aqui não muda nada nos outros módulos.</CardDescription></CardHeader><CardContent className="divide-y divide-border p-0 px-4">
    {(Object.keys(ALERT_LABELS) as BudgetAlertKind[]).map(k=><label key={k} className="flex cursor-pointer items-center gap-3 py-2.5"><span className="min-w-0 flex-1 text-sm">{ALERT_LABELS[k][0]}<span className="block text-xs text-muted-foreground">vem de {ALERT_LABELS[k][1]}</span></span><input type="checkbox" role="switch" checked={settings.alerts[k]} onChange={e=>setSettings({alerts:{...settings.alerts,[k]:e.target.checked}})} className="h-4 w-4 accent-primary"/></label>)}
   </CardContent></Card>
   <Card data-testid="budget-models"><CardHeader><CardTitle className="font-heading">Modelos de limites</CardTitle><CardDescription>Guarde os limites de um mês para usar de novo (mês normal, mês apertado…).</CardDescription></CardHeader><CardContent className="space-y-3">
    {settings.models.length?<ul className="divide-y divide-border">{settings.models.map(m=><li key={m.id} className="flex items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.name}</span><span className="text-xs text-muted-foreground">{m.note}</span></span><Button size="sm" variant="outline" onClick={()=>applyModel(m)}>Usar</Button><Button size="sm" variant="ghost" onClick={()=>setSettings({models:settings.models.filter(x=>x.id!==m.id)})}>Apagar</Button></li>)}</ul>:<p className="text-xs text-muted-foreground">Nenhum modelo ainda.</p>}
    <div className="flex gap-2"><Input className="h-8" value={modelName} onChange={e=>setModelName(e.target.value)} placeholder="Nome do modelo" maxLength={40}/><Button size="sm" variant="outline" onClick={saveModel}>Salvar atuais</Button></div>
   </CardContent></Card>
  </aside>
  </div>
 </div>
}