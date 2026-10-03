import { ArrowLeft, CalendarRange, History, SlidersHorizontal, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCurrentBudgetCycle, fetchNextBudgetCycle } from "@/lib/data";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PERIOD={semanal:"Semanal",quinzenal:"Quinzenal",mensal:"Mensal",anual:"Anual"} as const;
const MODE={"503020":"50/30/20",personalizado:"Personalizado"} as const;

export default function BudgetSettings(){
 const current=useQuery({queryKey:["budget-v2-current"],queryFn:fetchCurrentBudgetCycle});
 const next=useQuery({queryKey:["budget-v2-next"],queryFn:fetchNextBudgetCycle});
 return <div className="mx-auto max-w-3xl space-y-6 animate-fade-up">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><Link to="/orcamento" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4"/> Voltar ao orçamento</Link><h1 className="font-heading text-2xl font-bold">Configurações do orçamento</h1><p className="mt-1 text-sm text-muted-foreground">Modelo, periodicidade e regras ficam aqui — separados da sua visão diária.</p></div></div>
  <Card><CardHeader><CardTitle className="flex items-center gap-2 font-heading"><WalletCards className="h-5 w-5 text-primary"/> Orçamento atual</CardTitle><CardDescription>A configuração em uso neste ciclo.</CardDescription></CardHeader><CardContent>{current.data?<div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-muted/60 p-4"><p className="text-xs text-muted-foreground">Modelo</p><p className="mt-1 font-semibold">{MODE[current.data.mode]}</p></div><div className="rounded-xl bg-muted/60 p-4"><p className="text-xs text-muted-foreground">Periodicidade</p><p className="mt-1 font-semibold">{PERIOD[current.data.period]}</p></div></div>:<p className="text-sm text-muted-foreground">Nenhum ciclo V2 configurado ainda.</p>}</CardContent></Card>
  <Card><CardHeader><CardTitle className="flex items-center gap-2 font-heading"><CalendarRange className="h-5 w-5 text-primary"/> Próximo ciclo</CardTitle><CardDescription>Mudanças de modelo ou periodicidade devem ser preparadas para o próximo ciclo, preservando o histórico atual.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">{next.data?`${MODE[next.data.mode]} · ${PERIOD[next.data.period]} já programado.`:"Nenhuma alteração futura programada."}</p></CardContent></Card>
  <Card><CardHeader><CardTitle className="flex items-center gap-2 font-heading"><SlidersHorizontal className="h-5 w-5 text-primary"/> Regras avançadas</CardTitle><CardDescription>Prioridades, rolagem de saldo, ciclos extraordinários e distribuição por categoria ficarão centralizados aqui.</CardDescription></CardHeader><CardContent><div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><p>• Prioridade: essencial, flexível ou meta</p><p>• Rolagem de saldo por categoria</p><p>• Orçamentos extraordinários</p><p>• Planejamento antecipado do próximo ciclo</p></div></CardContent></Card>
  <Card><CardHeader><CardTitle className="flex items-center gap-2 font-heading"><History className="h-5 w-5 text-primary"/> Histórico protegido</CardTitle><CardDescription>Ciclos encerrados permanecem como foram planejados e realizados. Configurações novas não recalculam o passado.</CardDescription></CardHeader></Card>
 </div>
}