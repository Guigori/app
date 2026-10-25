import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, CreditCard, Plus, Wallet } from "lucide-react";
import { fetchAccounts, fetchCalendar, fetchDashboard, fetchMe } from "@/lib/data";
import { currentMonth, firstName, monthLabel } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { HomeFinancialChart } from "@/components/dashboard/HomeFinancialChart";
import { RadarSection } from "@/components/dashboard/RadarSection";
import { fetchRadar } from "@/lib/data";
import type { MetricKind } from "@/types/finnos";

const money = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const changeMonth = (month: string, delta: number) => {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const metric: Record<MetricKind, string> = { income: "receitas", expense: "despesas", balance: "caixa", invested: "projecao" };

export default function DashboardWeb() {
  const [month, setMonth] = useState(currentMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { hidden, toggle } = useBalanceHidden();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const dashboard = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month) });
  const calendar = useQuery({ queryKey: ["calendar", month], queryFn: () => fetchCalendar(month) });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const radar = useQuery({ queryKey: ["radar", month], queryFn: fetchRadar });
  const data = dashboard.data;
  const display = (amount: number) => hidden ? "••••••" : money(amount);
  const go = (kind: MetricKind) => navigate(`/fluxo?month=${month}&metric=${metric[kind]}`);
  const days = calendar.data?.days ?? [];
  const [year, m] = month.split("-").map(Number);
  const offset = new Date(year, m - 1, 1).getDay();
  const count = new Date(year, m, 0).getDate();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const selected = selectedDate ? byDate.get(selectedDate) : undefined;
  const today = new Date().toLocaleDateString("en-CA");

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 pb-10" data-testid="dashboard-web-v2">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Visão financeira</p>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Olá, {me.data ? firstName(me.data.name) : "bem-vindo"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Seu dinheiro, com clareza.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggle} className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted" aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}>{hidden ? "Mostrar valores" : "Ocultar valores"}</button>
          <button type="button" onClick={() => dialogs.openTransaction()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"><Plus size={17} /> Novo lançamento</button>
        </div>
      </header>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium"><CalendarDays size={17} className="text-primary" /> {monthLabel(month)}</div>
        <div className="flex items-center gap-2">
          <button aria-label="Mês anterior" onClick={() => { setMonth(changeMonth(month, -1)); setSelectedDate(null); }} className="rounded-lg p-2 hover:bg-muted"><ChevronLeft size={18} /></button>
          <button onClick={() => { setMonth(currentMonth()); setSelectedDate(null); }} className="rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-muted">Hoje</button>
          <button aria-label="Próximo mês" onClick={() => { setMonth(changeMonth(month, 1)); setSelectedDate(null); }} className="rounded-lg p-2 hover:bg-muted"><ChevronRight size={18} /></button>
        </div>
      </div>

      {dashboard.isError && <div role="alert" className="rounded-2xl border border-destructive/30 p-5 text-sm">Não foi possível carregar o resumo financeiro. <button className="ml-2 underline" onClick={() => dashboard.refetch()}>Tentar novamente</button></div>}
      {dashboard.isPending && <div className="h-44 animate-pulse rounded-2xl bg-muted" aria-label="Carregando resumo" />}
      {data && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo financeiro">
          {[
            { title: "Saldo disponível", amount: data.total_balance, icon: Wallet, kind: "balance" as MetricKind, highlight: true },
            { title: "Receitas do mês", amount: data.income, icon: ArrowDownLeft, kind: "income" as MetricKind },
            { title: "Despesas do mês", amount: data.expense, icon: ArrowUpRight, kind: "expense" as MetricKind },
            { title: "Resultado do mês", amount: data.month_balance, icon: CreditCard, kind: "balance" as MetricKind },
          ].map(({ title, amount, icon: Icon, kind, highlight }) => (
            <button key={title} onClick={() => go(kind)} className={`group rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${highlight ? "border-primary/30 bg-gradient-to-br from-[#070F52] to-[#4B2CFF] text-white" : "border-border bg-card"}`}>
              <div className="flex items-center justify-between gap-3"><span className={`text-sm ${highlight ? "text-white/75" : "text-muted-foreground"}`}>{title}</span><Icon size={18} className={highlight ? "text-white/75" : "text-primary"} /></div>
              <p className="mt-5 font-heading text-2xl font-semibold tracking-tight">{display(amount)}</p>
              <span className={`mt-3 inline-flex items-center gap-1 text-xs ${highlight ? "text-white/75" : "text-muted-foreground"}`}>Ver detalhes <ArrowRight size={12} /></span>
            </button>
          ))}
        </section>
      )}

      {accounts.isSuccess && accounts.data.length === 0 && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <div><h2 className="font-semibold">Comece cadastrando uma conta</h2><p className="mt-1 text-sm text-muted-foreground">Depois, registre sua primeira movimentação para acompanhar o saldo.</p></div>
          <Link to="/contas" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Cadastrar conta</Link>
        </section>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,1fr)]">
        <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="font-heading text-lg font-semibold">Calendário financeiro</h2><p className="text-xs text-muted-foreground">Entradas e saídas por dia</p></div><Link to="/fluxo" className="text-xs font-medium text-primary hover:underline">Ver fluxo <ArrowRight className="inline" size={12} /></Link></div>
          {calendar.isError && <div className="py-8 text-center text-sm text-muted-foreground">Calendário indisponível. <button onClick={() => calendar.refetch()} className="underline">Tentar novamente</button></div>}
          {calendar.isPending && <div className="h-72 animate-pulse rounded-xl bg-muted" />}
          {calendar.data && <>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <span key={d} className="py-2">{d}</span>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: offset }, (_, i) => <div key={`empty-${i}`} />)}
              {Array.from({ length: count }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, "0")}`;
                const day = byDate.get(date);
                const net = day ? day.income - day.expense : 0;
                return <button type="button" key={date} onClick={() => setSelectedDate(date)} aria-label={`Dia ${i + 1}`} aria-pressed={selectedDate === date} className={`min-h-16 rounded-xl border p-1.5 text-left transition hover:border-primary/40 sm:min-h-20 ${selectedDate === date ? "border-primary bg-primary/10" : date === today ? "border-primary/40 bg-primary/5" : "border-transparent bg-muted/40"}`}>
                  <span className="text-xs font-semibold">{i + 1}</span>
                  {day && (day.income !== 0 || day.expense !== 0) && <span className={`mt-2 block truncate text-[10px] font-semibold ${net < 0 ? "text-rose-500" : "text-emerald-600"}`}>{hidden ? "•••" : money(net)}</span>}
                </button>;
              })}
            </div>
            <div className="mt-4 rounded-xl bg-muted/60 p-3 text-sm">
              {selectedDate ? <><p className="font-semibold">Dia {selectedDate.slice(-2)}</p><p className="mt-1 text-muted-foreground">Receitas: {display(selected?.income ?? 0)} · Despesas: {display(selected?.expense ?? 0)}</p></> : <p className="text-muted-foreground">Selecione um dia para ver o resumo.</p>}
            </div>
          </>}
        </section>
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-heading text-lg font-semibold">Minhas contas</h2><Link to="/contas" className="text-xs font-medium text-primary">Ver todas</Link></div>
            {accounts.isPending && <p className="text-sm text-muted-foreground">Carregando contas…</p>}
            {accounts.isError && <p className="text-sm text-muted-foreground">Não foi possível carregar as contas.</p>}
            {accounts.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p>}
            <div className="space-y-2">{accounts.data?.slice(0, 4).map((a) => <Link key={a.id} to="/contas" className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-3 hover:bg-muted"><div className="min-w-0"><p className="truncate text-sm font-semibold">{a.name}</p><p className="truncate text-xs text-muted-foreground">{a.institution}</p></div><span className="shrink-0 text-sm font-semibold">{display(a.balance)}</span></Link>)}</div>
          </section>
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-heading text-lg font-semibold">Movimentações recentes</h2><Link to="/transacoes" className="text-xs font-medium text-primary">Ver todas</Link></div>
            {data?.recent.length ? data.recent.slice(0, 5).map((tx) => <div key={tx.id} className="flex items-center justify-between gap-3 border-b border-border/70 py-3 last:border-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{tx.name}</p><p className="text-xs text-muted-foreground">{tx.date} · {tx.category_name ?? tx.type}</p></div><span className={`shrink-0 text-sm font-semibold ${tx.type === "despesa" ? "text-rose-500" : "text-emerald-600"}`}>{tx.type === "despesa" ? "−" : "+"}{display(tx.value)}</span></div>) : <p className="py-4 text-sm text-muted-foreground">Ainda não há movimentações neste mês.</p>}
          </section>
        </div>
      </div>
      {data && <section className="rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="mb-3 flex items-center justify-between"><h2 className="font-heading text-lg font-semibold">Evolução financeira</h2><Link to="/fluxo" className="text-xs font-medium text-primary">Análise completa</Link></div><HomeFinancialChart month={data.month} total={data.total_balance} income={data.income} expense={data.expense} result={data.month_balance} onOpenMetric={go} menuView="Projeção" menuInterval="1 mês" menuSeries={["Receitas", "Despesas", "Resultado"]} /></section>}
      <RadarSection signals={radar.data?.items ?? []} totalCount={radar.data?.count ?? 0} />
    </div>
  );
}
