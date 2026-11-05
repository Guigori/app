import { useState } from "react";
import { useLocation } from "react-router-dom";
import CriarMeta from "@/components/patrimonio/CriarMeta";
import EditarMeta from "@/components/patrimonio/EditarMeta";
import RendaPassiva from "@/components/patrimonio/RendaPassiva";
import { GoalCard } from "@/components/patrimonio/GoalCard";
import { Investimentos } from "@/components/patrimonio/Investimentos";
import { investmentTotals, listInvestments } from "@/lib/investments";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Landmark, ShieldCheck, Sparkles, Target, TrendingUp, Wallet } from "lucide-react";
import { fetchAccounts, fetchMe } from "@/lib/data";
import { listGoals, type FinnosGoal } from "@/lib/goals";
import { useBalanceHidden } from "@/lib/balance";

type Tab = "geral" | "metas" | "investimentos";
const currency = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export default function Patrimonio() {
  const location = useLocation();
  const [tab, setTab] = useState<Tab>(location.pathname === "/metas" ? "metas" : location.pathname === "/investimentos" ? "investimentos" : "geral");
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<FinnosGoal | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const goalsQuery = useQuery({queryKey:["goals",me.data?.id], queryFn:()=>listGoals(me.data!.id),enabled:!!me.data});
  const goals = goalsQuery.data ?? [];
  const { hidden, toggle } = useBalanceHidden();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const wallet = (accounts.data ?? []).filter(a => a.active).reduce((sum, a) => sum + a.balance, 0);
  const investmentsQuery = useQuery({ queryKey: ["investments", me.data?.id], queryFn: () => listInvestments(me.data!.id), enabled: !!me.data });
  const invested = investmentTotals(investmentsQuery.data ?? []).current;
  const display = (n: number) => hidden ? "••••••" : currency(n);
  return <div className="mx-auto max-w-4xl space-y-5 pb-12" data-testid="patrimonio-page">
    <header className="flex items-start justify-between gap-3">
      <div><p className="text-xs font-semibold tracking-widest text-muted-foreground">FINNOS · PATRIMÔNIO</p><h1 className="mt-2 text-3xl font-bold">Seu patrimônio</h1><p className="mt-2 text-sm text-muted-foreground">Acompanhe o que você construiu e planeje suas próximas conquistas.</p></div>
      <button onClick={toggle} aria-label={hidden ? "Exibir valores" : "Ocultar valores"} className="rounded-full border p-3">{hidden ? <EyeOff size={20}/> : <Eye size={20}/>}</button>
    </header>
    <section className="rounded-[26px] bg-[#090F50] p-6 text-white"><div className="flex justify-between"><span className="text-white/75">Patrimônio identificado</span><Landmark className="text-[#A46DFF]"/></div><p className="mt-5 text-3xl font-bold">{accounts.data ? display(wallet + invested) : "—"}</p><div className="mt-5 h-2 rounded-full bg-white/15"><div className="h-full rounded-full bg-primary" style={{width:accounts.data?"100%":"0%"}}/></div><p className="mt-3 text-xs text-white/70">Saldo das contas + valor atual dos investimentos que você cadastrou.</p></section>
    <div role="tablist" aria-label="Áreas do patrimônio" className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1 text-xs sm:text-sm">{([["geral","Visão geral"],["metas","Metas"],["investimentos","Investimentos"]] as const).map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)} className={`rounded-full px-1 py-3 font-semibold ${tab===id?"bg-card shadow-sm":"text-muted-foreground"}`}>{label}</button>)}</div>
    {tab==="geral"&&<div className="space-y-4"><div className="grid grid-cols-2 gap-3"><div className="rounded-3xl bg-muted p-4"><Wallet className="text-primary"/><p className="mt-3 text-sm">Saldo na Carteira</p><strong className="text-lg">{accounts.data?display(wallet):"—"}</strong></div><div className="rounded-3xl bg-muted p-4"><Target className="text-primary"/><p className="mt-3 text-sm">Metas reservadas</p><strong className="text-lg">—</strong></div></div><button onClick={()=>setTab("investimentos")} className="flex w-full items-center gap-3 rounded-3xl bg-muted p-4 text-left"><TrendingUp className="text-primary"/> Investimentos <span className="ml-auto text-muted-foreground">Sem dados</span></button><section className="rounded-3xl border p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="text-primary"/> Seguro para gastar</h2><p className="mt-3 text-sm text-muted-foreground">Aguardando integração de compromissos futuros, reservas e investimentos. Saldo bancário não é automaticamente seguro para gastar.</p></section><section className="rounded-3xl border p-5"><h2 className="text-lg font-bold">Distribuição do patrimônio</h2><div className="mt-5 h-3 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:accounts.data?"100%":"0%"}}/></div><div className="mt-5 space-y-3">{["Carteira","Metas reservadas","Investimentos"].map((name,i)=><div key={name} className="flex items-center gap-3"><span className="h-3 w-3 rounded-full" style={{background:["#4B2CFF","#8058FF","#A46DFF"][i]}}/><span className="flex-1">{name}</span><strong>{i===0&&accounts.data?"100%":"—"}</strong></div>)}</div></section><section className="rounded-3xl bg-[#F4F1FF] p-5 text-[#151515] dark:bg-[#241A48] dark:text-white"><h2 className="flex items-center gap-2 font-bold"><Sparkles className="text-primary"/> Descobertas FINNOS</h2><p className="mt-3 text-sm">As oportunidades serão exibidas quando houver análise fundamentada em dados reais.</p></section></div>}
    {accounts.isError && <div role="alert" className="rounded-2xl border border-destructive/30 p-4 text-sm text-destructive">Não foi possível consultar os saldos do patrimônio. <button type="button" onClick={() => void accounts.refetch()} className="font-semibold underline">Tentar novamente</button></div>}
    {tab==="metas" && goalsQuery.isPending && <div role="status" className="rounded-2xl border p-5 text-sm text-muted-foreground">Carregando suas metas...</div>}
    {tab==="metas" && goalsQuery.isError && <div role="alert" className="rounded-2xl border border-destructive/30 p-5 text-sm text-destructive">Não foi possível carregar suas metas. <button type="button" onClick={() => void goalsQuery.refetch()} className="font-semibold underline">Tentar novamente</button></div>}
    {tab==="metas"&&!goalsQuery.isPending&&!goalsQuery.isError&&(editingGoal && me.data ? <EditarMeta key={editingGoal.id} goal={editingGoal} userId={me.data.id} onSaved={()=>{void goalsQuery.refetch();setEditingGoal(null)}} onClose={()=>setEditingGoal(null)}/> : creatingGoal && me.data ? <CriarMeta userId={me.data.id} onSaved={()=>void goalsQuery.refetch()} onClose={()=>setCreatingGoal(false)}/> : <section className="rounded-3xl border p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Minhas metas</h2><p className="mt-1 text-sm text-muted-foreground">Seus planos, seu ritmo.</p></div><button disabled={!me.data} onClick={()=>setCreatingGoal(true)} className="rounded-full bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50">+ Nova meta</button></div>{goals.length===0?<p className="mt-5 text-sm text-muted-foreground">Nenhuma meta salva. Crie sua primeira meta.</p>:<div className="mt-5 grid gap-3 sm:grid-cols-2">{goals.map(goal=><GoalCard key={goal.id} goal={goal} userId={me.data!.id} accounts={accounts.data ?? []} display={display} onEdit={()=>setEditingGoal(goal)} onSaved={()=>void goalsQuery.refetch()}/>)}</div>}<p className="mt-4 text-xs text-muted-foreground">Metas da conta sincronizadas; o planejamento não movimenta dinheiro.</p></section>)}
    {tab==="investimentos"&&<section className="rounded-3xl border p-5"><h2 className="mb-4 text-xl font-bold">Meus investimentos</h2>{me.data?<Investimentos userId={me.data.id} display={display}/>:null}<div className="mt-5"><RendaPassiva/></div></section>}
    <p className="text-center text-xs text-muted-foreground">Implementação inicial. Sem alterações em saldos ou transações.</p>
  </div>;
}
