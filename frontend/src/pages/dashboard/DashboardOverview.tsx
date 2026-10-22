import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Eye, EyeOff, Plus, Sparkles } from "lucide-react";
import { fetchAccounts, fetchDashboard, fetchRadar, fetchTrends } from "@/lib/data";
import { currentMonth, monthLabel } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import type { Transaction } from "@/types/finnos";

const money = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const panel = "rounded-xl border border-black/[0.07] bg-white dark:border-white/10 dark:bg-[#1b1c22]";
function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function Kpi({ title, value, detail, hidden }: { title: string; value: number; detail: string; hidden: boolean }) {
  return <section className={`${panel} p-5`}><p className="text-xs font-medium text-neutral-500">{title}</p><p className="mt-4 text-[27px] font-semibold tracking-tight tabular-nums">{hidden ? "••••••" : money(value)}</p><p className="mt-2 text-xs text-neutral-500">{detail}</p></section>;
}
function TransactionRow({ tx, hidden }: { tx: Transaction; hidden: boolean }) {
  const income = tx.type === "receita";
  return <div className="flex items-center gap-3 border-t border-black/[0.05] py-3 first:border-0 dark:border-white/10">
    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${income ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20" : "bg-neutral-100 text-neutral-600 dark:bg-white/10"}`}>{income ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</div>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{tx.name}</p><p className="truncate text-xs text-neutral-500">{tx.category_name || tx.account_name || "Sem categoria"} · {tx.date}</p></div>
    <span className="shrink-0 text-sm font-semibold tabular-nums">{hidden ? "••••" : `${income ? "+" : tx.type === "despesa" ? "−" : ""}${money(tx.installment_value ?? tx.adjusted_value ?? tx.value)}`}</span>
  </div>;
}

export default function DashboardOverview() {
  const [month, setMonth] = useState(currentMonth());
  const { hidden, toggle } = useBalanceHidden();
  const summary = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month) });
  const trends = useQuery({ queryKey: ["trends", 6, month], queryFn: () => fetchTrends(6, month) });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const radar = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 60_000 });
  const d = summary.data;
  const noAccounts = accounts.isSuccess && accounts.data.length === 0;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#5b35ff]">Visão geral</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Seu dinheiro, em perspectiva.</h1><p className="mt-2 text-sm text-neutral-500">Acompanhe sua vida financeira com clareza.</p></div>
      <div className="flex items-center gap-2">
        <div className={`${panel} flex items-center rounded-lg p-1`}><button aria-label="Mês anterior" onClick={() => setMonth(m => shiftMonth(m, -1))} className="rounded-md p-2 hover:bg-neutral-100 dark:hover:bg-white/10"><ChevronLeft size={16}/></button><span className="min-w-28 text-center text-xs font-medium capitalize">{monthLabel(month)}</span><button aria-label="Próximo mês" onClick={() => setMonth(m => shiftMonth(m, 1))} className="rounded-md p-2 hover:bg-neutral-100 dark:hover:bg-white/10"><ChevronRight size={16}/></button></div>
        <button aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} onClick={toggle} className={`${panel} p-2.5`}>{hidden ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
        <Link to="/registro-inteligente" className="inline-flex items-center gap-2 rounded-lg bg-[#4b2cff] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#3c22dc]"><Plus size={16}/> Novo registro</Link>
      </div>
    </div>
    {summary.isPending && <div role="status" className={`${panel} p-6 text-sm text-neutral-500`}>Carregando seus dados financeiros…</div>}
    {summary.isError && <div role="alert" className={`${panel} flex flex-wrap items-center justify-between gap-3 p-5`}><p className="text-sm">Não foi possível carregar o resumo financeiro.</p><button className="text-sm font-medium text-[#5b35ff]" onClick={() => summary.refetch()}>Tentar novamente</button></div>}
    {noAccounts && <div className={`${panel} flex flex-wrap items-center justify-between gap-3 p-5`}><p className="text-sm">Cadastre sua primeira conta para começar a acompanhar suas finanças.</p><Link className="text-sm font-semibold text-[#5b35ff]" to="/contas">Cadastrar conta →</Link></div>}
    {d && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Saldo consolidado" value={d.total_balance} detail="Disponível nas contas" hidden={hidden}/>
        <Kpi title="Receitas" value={d.income} detail="Entradas no período" hidden={hidden}/>
        <Kpi title="Despesas" value={d.expense} detail="Saídas no período" hidden={hidden}/>
        <Kpi title="Resultado do mês" value={d.month_balance} detail="Receitas menos despesas" hidden={hidden}/>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(290px,1fr)]">
        <section className={`${panel} min-w-0 p-5`}>
          <div className="mb-6 flex items-start justify-between"><div><h2 className="text-sm font-semibold">Evolução financeira</h2><p className="mt-1 text-xs text-neutral-500">Resultado mensal dos últimos seis meses</p></div><Link to="/analise" className="text-xs font-medium text-[#5b35ff]">Analisar →</Link></div>
          {trends.isPending ? <div className="grid h-64 place-items-center text-xs text-neutral-500">Carregando evolução…</div> : trends.isError ? <div className="grid h-64 place-items-center text-xs text-neutral-500">Evolução indisponível</div> : trends.data?.months.length ? <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trends.data.months} margin={{top:8,right:8,left:0,bottom:0}}><defs><linearGradient id="finnos-dashboard-net" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b35ff" stopOpacity={0.15}/><stop offset="100%" stopColor="#5b35ff" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#9ca3af" strokeOpacity={0.13} vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fontSize:11,fill:"#8b8b94"}}/><YAxis hide/><Tooltip formatter={(v) => hidden ? "••••" : money(Number(v))} contentStyle={{borderRadius:10,fontSize:12}}/><Area dataKey="net" name="Resultado" type="monotone" stroke="#5b35ff" strokeWidth={2.5} fill="url(#finnos-dashboard-net)"/></AreaChart></ResponsiveContainer></div> : <div className="grid h-64 place-items-center text-xs text-neutral-500">Ainda não há histórico suficiente.</div>}
        </section>
        <section className={`${panel} p-5`}>
          <div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-semibold">Para onde foi o dinheiro</h2><Link to="/fluxo" className="text-xs text-[#5b35ff]">Ver fluxo →</Link></div>
          {d.categories.length ? <div className="space-y-4">{d.categories.slice(0,6).map(c => <div key={c.category_id ?? c.name}><div className="mb-2 flex justify-between gap-3 text-xs"><span className="truncate text-neutral-600 dark:text-neutral-300">{c.name}</span><span className="shrink-0 font-medium tabular-nums">{hidden ? "••••" : money(c.total)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10"><div className="h-full rounded-full bg-[#5b35ff]" style={{width:`${Math.min(100,Math.max(0,c.percent))}%`}}/></div></div>)}</div> : <p className="text-sm text-neutral-500">Nenhuma despesa categorizada neste mês.</p>}
        </section>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(290px,1fr)]">
        <section className={`${panel} min-w-0 p-5`}><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Movimentações recentes</h2><p className="mt-1 text-xs text-neutral-500">Últimos lançamentos</p></div><Link to="/transacoes" className="text-xs font-medium text-[#5b35ff]">Ver todas →</Link></div>{d.recent.length ? d.recent.slice(0,6).map(tx=><TransactionRow key={tx.id} tx={tx} hidden={hidden}/>) : <p className="py-8 text-sm text-neutral-500">Nenhuma movimentação registrada.</p>}</section>
        <section className={`${panel} p-5`}><div className="mb-5 flex items-center gap-2"><Sparkles size={16} className="text-[#5b35ff]"/><h2 className="text-sm font-semibold">Radar FINNOS</h2></div>{radar.isPending ? <p className="text-sm text-neutral-500">Consultando alertas…</p> : radar.isError ? <p className="text-sm text-neutral-500">Alertas indisponíveis.</p> : radar.data?.items.length ? <div className="space-y-3">{radar.data.items.slice(0,4).map(signal=><Link key={signal.id} to={`/radar/${encodeURIComponent(signal.id)}`} className="block rounded-lg border border-black/[0.06] p-3 transition-colors hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"><p className="text-xs font-semibold">{signal.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">{signal.description}</p></Link>)}</div> : <p className="text-sm text-neutral-500">Nenhum alerta relevante no momento.</p>}<Link to="/radar" className="mt-5 inline-block text-xs font-medium text-[#5b35ff]">Abrir Radar →</Link></section>
      </div>
    </>}
  </div>;
}
