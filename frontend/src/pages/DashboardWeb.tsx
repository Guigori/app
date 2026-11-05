import { useRouteState } from "@/lib/routeState";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, CreditCard, Eye, EyeOff, Wallet } from "lucide-react";
import { fetchAccounts, fetchCalendar, fetchDashboard, fetchMe } from "@/lib/data";
import { currentMonth, firstName, formatDate, monthLabel } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { TransactionCalendar } from "@/components/transactions/TransactionCalendar";
import { HomeFinancialChart } from "@/components/dashboard/HomeFinancialChart";
import { ExpensesDonutChart } from "@/components/dashboard/ExpensesDonutChart";
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
  const [month, setMonth] = useRouteState("inicio-web:month", currentMonth);
  const [chartView, setChartView] = useRouteState<"Projeção" | "Linhas" | "Barras" | "Pizza">("inicio-web:chart", "Projeção");
  const [chartPeriod, setChartPeriod] = useRouteState("inicio-web:period", "1 mês");
  const { hidden, toggle } = useBalanceHidden();
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
  const count = new Date(year, m, 0).getDate();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const today = new Date().toLocaleDateString("en-CA");
  // Daily trend series for the summary cards: cumulative income/expense/net up
  // to today (current month) or the whole month, and the balance walked back
  // from today's total so the last point equals "Saldo disponível".
  const lastDay = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : count;
  const daily = Array.from({ length: lastDay }, (_, i) => byDate.get(`${month}-${String(i + 1).padStart(2, "0")}`));
  const cumulative = (pick: (d: (typeof days)[number]) => number) => {
    let total = 0;
    return daily.map((d) => (total += d ? pick(d) : 0));
  };
  const incomeSeries = cumulative((d) => d.income);
  const expenseSeries = cumulative((d) => d.expense);
  const netSeries = incomeSeries.map((v, i) => v - expenseSeries[i]);
  const balanceSeries = data ? netSeries.map((v) => data.total_balance - (netSeries[netSeries.length - 1] ?? 0) + v) : [];

  const pickMonth = (next: string) => setMonth(next);

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 pb-10" data-testid="dashboard-web-v2">
      {/* One quiet header: greeting, eye (show/hide values) and the month. New entries use the global + button. */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Olá, {me.data ? firstName(me.data.name) : "bem-vindo"}</h1>
        <div className="flex items-center gap-1">
          <button type="button" onClick={toggle} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/75 transition-colors hover:bg-muted hover:text-foreground" aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} aria-pressed={hidden} title={hidden ? "Mostrar valores" : "Ocultar valores"}>
            {hidden ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
          </button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
          <button aria-label="Mês anterior" onClick={() => pickMonth(changeMonth(month, -1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"><ChevronLeft size={18} /></button>
          <span className="min-w-36 text-center text-sm font-medium" data-testid="dashboard-month-label">{monthLabel(month)}</span>
          <button aria-label="Próximo mês" onClick={() => pickMonth(changeMonth(month, 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"><ChevronRight size={18} /></button>
          {month !== currentMonth() ? <button onClick={() => pickMonth(currentMonth())} className="rounded-full px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted">Hoje</button> : null}
        </div>
      </header>

      {dashboard.isError && <div role="alert" className="rounded-2xl border border-destructive/30 p-5 text-sm">Não foi possível carregar o resumo financeiro. <button className="ml-2 underline" onClick={() => dashboard.refetch()}>Tentar novamente</button></div>}
      {dashboard.isPending && <div className="h-36 animate-pulse rounded-2xl bg-muted" aria-label="Carregando resumo" />}
      {data && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo financeiro">
          {[
            { title: "Saldo disponível", amount: data.total_balance, icon: Wallet, kind: "balance" as MetricKind, highlight: true, series: balanceSeries, tone: "text-white" },
            { title: "Receitas do mês", amount: data.income, icon: ArrowDownLeft, kind: "income" as MetricKind, series: incomeSeries, tone: "text-income" },
            { title: "Despesas do mês", amount: data.expense, icon: ArrowUpRight, kind: "expense" as MetricKind, series: expenseSeries, tone: "text-expense" },
            { title: "Resultado do mês", amount: data.month_balance, icon: CreditCard, kind: "balance" as MetricKind, series: netSeries, tone: data.month_balance >= 0 ? "text-income" : "text-expense" },
          ].map(({ title, amount, icon: Icon, kind, highlight, series, tone }) => (
            <button key={title} onClick={() => go(kind)} className={`group rounded-2xl border p-5 text-left transition-colors hover:border-primary/30 ${highlight ? "border-primary/30 bg-gradient-to-br from-[#070F52] to-[#4B2CFF] text-white" : "border-border bg-card"}`}>
              <div className="flex items-center justify-between gap-3"><span className={`text-sm ${highlight ? "text-white/75" : "text-muted-foreground"}`}>{title}</span><Icon size={18} className={highlight ? "text-white/75" : "text-primary"} /></div>
              <p className="mt-3 font-heading text-2xl font-semibold tracking-tight tabular-nums">{display(amount)}</p>
              <Sparkline values={hidden ? [] : series} className={`mt-3 ${tone} ${highlight ? "opacity-90" : ""}`} label={`Evolução de ${title.toLowerCase()} no mês`} />
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

      {/* Chart and calendar share one row with equal height: no blank gap under either. */}
      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {data ? (
          <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-heading text-base font-semibold">Evolução financeira</h2><p className="text-xs text-muted-foreground">{chartView === "Projeção" ? "Saldo real até hoje e estimativa até o fim do mês" : "Receitas, despesas e resultado"}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Tipo de gráfico" value={chartView} onChange={(e) => setChartView(e.target.value as typeof chartView)} className="h-8 rounded-full border border-border bg-background px-3 text-xs">
                  <option value="Projeção">Projeção</option><option value="Linhas">Linhas</option><option value="Barras">Barras</option><option value="Pizza">Pizza</option>
                </select>
                <select aria-label="Período do gráfico" value={chartPeriod} onChange={(e) => setChartPeriod(e.target.value)} className="h-8 rounded-full border border-border bg-background px-3 text-xs">
                  <option>7 dias</option><option>1 mês</option><option>3 meses</option><option>6 meses</option><option>1 ano</option>
                </select>
                <Link to={`/fluxo?month=${month}`} className="text-xs font-medium text-primary hover:underline">Fluxo de caixa <ArrowRight className="inline" size={12} /></Link>
              </div>
            </div>
            <div className="mt-2 flex-1">
              <HomeFinancialChart month={data.month} total={data.total_balance} income={data.income} expense={data.expense} result={data.month_balance} onOpenMetric={go} menuView={chartView} menuInterval={chartPeriod} menuSeries={["Receitas", "Despesas", "Resultado"]} bare />
            </div>
          </section>
        ) : <div className="h-96 animate-pulse rounded-2xl bg-muted" />}
        <div className="flex min-w-0 flex-col">
          {calendar.isError ? (
            <div className="flex h-full items-center justify-center rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">Calendário indisponível. <button onClick={() => calendar.refetch()} className="ml-1 underline">Tentar novamente</button></div>
          ) : calendar.data ? (
            // Same heatmap as Fluxo; a day opens Fluxo on that date.
            <TransactionCalendar
              compact
              className="h-full"
              month={month}
              days={calendar.data.days}
              selectedDate={month === today.slice(0, 7) ? today : `${month}-01`}
              expanded
              onToggleExpanded={() => undefined}
              onMonthChange={pickMonth}
              onSelectDate={(date) => navigate(`/transacoes?date=${date}`)}
            />
          ) : <div className="h-full min-h-80 animate-pulse rounded-2xl bg-muted" />}
        </div>
      </div>

      <div className="grid items-stretch gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-heading text-base font-semibold">Minhas contas</h2><Link to="/contas" className="text-xs font-medium text-primary hover:underline">Ver todas</Link></div>
          {accounts.isPending && <p className="text-sm text-muted-foreground">Carregando contas…</p>}
          {accounts.isError && <p className="text-sm text-muted-foreground">Não foi possível carregar as contas.</p>}
          {accounts.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p>}
          <div className="divide-y divide-border/70">{accounts.data?.slice(0, 5).map((a) => <Link key={a.id} to="/contas" className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-3 hover:bg-muted/50"><div className="min-w-0"><p className="truncate text-sm font-medium">{a.name}</p><p className="truncate text-xs text-muted-foreground">{a.institution}</p></div><span className="shrink-0 text-sm font-semibold tabular-nums">{display(a.balance)}</span></Link>)}</div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-heading text-base font-semibold">Movimentações recentes</h2><Link to={`/transacoes?month=${month}`} className="text-xs font-medium text-primary hover:underline">Ver todas</Link></div>
          {data?.recent.length ? <div className="divide-y divide-border/70">{data.recent.slice(0, 5).map((tx) => <Link key={tx.id} to={`/transacoes?date=${tx.date}&highlight=${tx.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-3 hover:bg-muted/50"><div className="min-w-0"><p className="truncate text-sm font-medium">{tx.name}</p><p className="text-xs text-muted-foreground">{formatDate(tx.date)} · {tx.category_name ?? tx.type}</p></div><span className={`shrink-0 text-sm font-semibold tabular-nums ${tx.type === "despesa" ? "text-expense" : "text-income"}`}>{tx.type === "despesa" ? "−" : "+"}{display(tx.value)}</span></Link>)}</div> : <p className="py-4 text-sm text-muted-foreground">Ainda não há movimentações neste mês.</p>}
        </section>
        {data ? <ExpensesDonutChart className="lg:col-span-2 2xl:col-span-1" month={data.month} slices={data.categories} total={data.expense} onOpenDetails={() => go("expense")} onOpenCategory={(slice) => navigate(`/transacoes?month=${month}&metric=despesas&category_id=${encodeURIComponent(slice.category_id ?? "")}`)} /> : null}
      </div>
      <RadarSection signals={radar.data?.items ?? []} totalCount={radar.data?.count ?? 0} loading={radar.isPending} error={radar.isError} onRetry={() => void radar.refetch()} />
    </div>
  );
}
