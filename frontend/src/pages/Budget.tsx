import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock3, Gauge, History, Settings2, ShieldCheck, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchBudgetCycles, fetchBudgetCycleProgress, fetchCurrentBudgetCycle, fetchNextBudgetCycle } from "@/lib/data";
import { formatBRL } from "@/lib/format";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PERIOD = { semanal:"Semanal", quinzenal:"Quinzenal", mensal:"Mensal", anual:"Anual" } as const;
const MODE = { "503020":"50/30/20", personalizado:"Personalizado" } as const;

function dateLabel(v:string){ return new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"short"}).format(new Date(v+"T12:00:00")); }

export default function Budget() {
  const [tab,setTab]=useState<"atual"|"proximo"|"historico">("atual");
  const current=useQuery({queryKey:["budget-v2-current"],queryFn:fetchCurrentBudgetCycle});
  const next=useQuery({queryKey:["budget-v2-next"],queryFn:fetchNextBudgetCycle});
  const history=useQuery({queryKey:["budget-v2-history"],queryFn:fetchBudgetCycles,enabled:tab==="historico"});
  const cycle=tab==="atual"?current.data:tab==="proximo"?next.data:null;
  const progress=useQuery({queryKey:["budget-v2-progress",cycle?.id],queryFn:()=>fetchBudgetCycleProgress(cycle!.id),enabled:Boolean(cycle?.id)});
  if(current.isPending) return <FinnosPageLoading title="Carregando orçamento" description="Organizando seu ciclo financeiro." />;

  return <div className="space-y-6 animate-fade-up">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="font-heading text-2xl font-bold tracking-tight">Orçamento</h1><p className="mt-1 text-sm text-muted-foreground">Acompanhe seu plano sem misturar configuração com o dia a dia.</p></div>
      <Link to="/orcamento/configuracoes" className={buttonVariants({variant:"outline",size:"sm"})} data-testid="budget-settings-button"><Settings2 className="h-4 w-4"/> Configurar orçamento</Link>
    </div>
    <div className="inline-flex rounded-xl bg-muted p-1">
      {([["atual","Atual"],["proximo","Próximo ciclo"],["historico","Histórico"]] as const).map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors",tab===key?"bg-background text-foreground shadow-sm":"text-muted-foreground hover:text-foreground")}>{label}</button>)}
    </div>

    {tab==="historico" ? <div className="space-y-3">{(history.data??[]).filter(c=>c.status==="fechado").length===0?<Card><CardContent className="py-10 text-center"><History className="mx-auto mb-3 h-6 w-6 text-muted-foreground"/><p className="font-medium">Nenhum ciclo fechado ainda</p><p className="mt-1 text-sm text-muted-foreground">Quando um ciclo terminar, ele ficará guardado aqui sem alterar o histórico.</p></CardContent></Card>:(history.data??[]).filter(c=>c.status==="fechado").map(c=><Card key={c.id}><CardContent className="flex items-center justify-between py-4"><div><p className="font-semibold">{PERIOD[c.period]} · {MODE[c.mode]}</p><p className="text-sm text-muted-foreground">{dateLabel(c.start_date)} — {dateLabel(c.end_date)}</p></div><ChevronRight className="h-4 w-4 text-muted-foreground"/></CardContent></Card>)}</div> :
    !cycle ? <Card><CardContent className="py-10 text-center"><WalletCards className="mx-auto mb-3 h-7 w-7 text-primary"/><p className="font-heading text-lg font-bold">{tab==="atual"?"Seu novo orçamento ainda não foi configurado":"Nenhum próximo ciclo preparado"}</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{tab==="atual"?"Configure o modelo, periodicidade e limites. O FINNOS manterá cada ciclo separado para preservar seu histórico.":"Você poderá preparar o próximo ciclo antes do atual terminar."}</p><Link to="/orcamento/configuracoes" className={cn(buttonVariants({}),"mt-4")}>Configurar orçamento</Link></CardContent></Card> :
    progress.isPending || !progress.data ? <FinnosPageLoading title="Calculando ciclo" description="Separando realizado, comprometido e disponível."/> :
    <><Card className="overflow-hidden"><CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">{PERIOD[cycle.period]} · {MODE[cycle.mode]}</p><CardTitle className="mt-1 font-heading">{dateLabel(cycle.start_date)} — {dateLabel(cycle.end_date)}</CardTitle></div><div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium"><Clock3 className="h-3.5 w-3.5"/> {Math.round(progress.data.elapsed_percent)}% do ciclo</div></div></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["Planejado",progress.data.planned],["Realizado",progress.data.spent],["Comprometido",progress.data.committed],["Disponível",progress.data.available]].map(([l,v])=><div key={String(l)} className="rounded-2xl bg-muted/55 p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 font-heading text-xl font-bold tabular-nums">{formatBRL(Number(v))}</p></div>)}
      </div>
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><div className="flex items-start gap-3"><span className="rounded-xl bg-primary/10 p-2 text-primary"><ShieldCheck className="h-5 w-5"/></span><div className="min-w-0"><p className="text-sm font-medium text-muted-foreground">Livre de verdade</p><p className="font-heading text-3xl font-bold tabular-nums">{formatBRL(progress.data.safe_to_spend)}</p><p className="mt-1 text-xs text-muted-foreground">Considerando o que já saiu e os compromissos conhecidos deste ciclo.</p></div></div></div>
      <div><div className="mb-2 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-medium"><Gauge className="h-4 w-4"/> Ritmo do orçamento</span><span className="text-muted-foreground">{Math.round(progress.data.used_percent)}% comprometido</span></div><div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{width:`${Math.min(progress.data.used_percent,100)}%`}}/></div><p className="mt-2 text-xs text-muted-foreground">{progress.data.pace==="acima"?"O uso está acima do ritmo do ciclo.":progress.data.pace==="abaixo"?"Você está usando menos do que o ritmo previsto.":progress.data.pace==="no_ritmo"?"Seu orçamento está acompanhando o ritmo do ciclo.":"Defina valores planejados para acompanhar o ritmo."}</p></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="font-heading text-base">Categorias</CardTitle></CardHeader><CardContent><ul className="divide-y divide-border">{progress.data.allocations.map(a=><li key={a.category_id} className="py-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{backgroundColor:(a.color??"#64748B")+"1A",color:a.color??"#64748B"}}><CategoryIcon name={a.icon??"more-horizontal"} className="h-4.5 w-4.5"/></span><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{a.name??"Categoria"}</p><p className="text-sm tabular-nums">{formatBRL(a.spent)} <span className="text-muted-foreground">+ {formatBRL(a.committed)} comprometido</span></p></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:`${Math.min(a.percent,100)}%`}}/></div><div className="mt-1.5 flex justify-between text-xs text-muted-foreground"><span>{Math.round(a.percent)}% previsto</span><span>{formatBRL(a.available)} disponível</span></div></div></div></li>)}</ul></CardContent></Card></>}
  </div>;
}