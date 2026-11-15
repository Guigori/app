import { useRouteState } from "@/lib/routeState";
import { BackupReminder } from "@/components/settings/BackupReminder";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import { fetchAccounts, fetchDashboard, fetchMe } from "@/lib/data";
import { WidgetBoard } from "@/components/insights/WidgetBoard";
import { currentMonth, firstName, monthLabel } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { BalanceHeroCard } from "@/components/dashboard/BalanceHeroCard";
import { PendingCaptures } from "@/components/pending/PendingCaptures";
import { HOME_LIMIT } from "@/lib/pendingCaptures";
import { offerHomeWidgetsOnce } from "@/lib/insights/layout";
import { HomeFinancialChart } from "@/components/dashboard/HomeFinancialChart";
import { CHART_RANGES, pickOne, useChartPreference } from "@/lib/chartPreferences";
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
  // Same saved choice as the phone Home, so the chart opens the way it was left.
  const [chartView, setChartView] = useChartPreference<"Projeção" | "Linhas" | "Barras" | "Pizza">("view", (v) => pickOne(v, ["Projeção", "Linhas", "Barras", "Pizza"] as const, "Projeção"));
  const [chartPeriod, setChartPeriod] = useChartPreference<string>("interval", (v) => pickOne(v, CHART_RANGES, "1 mês"));
  const { hidden, toggle } = useBalanceHidden();
  const navigate = useNavigate();
  const dashboard = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month) });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const data = dashboard.data;
  const go = (kind: MetricKind) => navigate(`/transacoes?aba=caixa&month=${month}&metric=${metric[kind]}`);
  // The calendar, the latest entries and the accounts live in the painel now (once, the person can remove them).
  useEffect(() => { offerHomeWidgetsOnce(); }, []);

  const pickMonth = (next: string) => setMonth(next);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 pb-10 min-[1800px]:max-w-[1680px]" data-testid="dashboard-web-v2">
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

      <BackupReminder />
      {dashboard.isError && <div role="alert" className="rounded-2xl border border-destructive/30 p-5 text-sm">Não foi possível carregar o resumo financeiro. <button className="ml-2 underline" onClick={() => dashboard.refetch()}>Tentar novamente</button></div>}
      {dashboard.isPending && <div className="h-[28rem] animate-pulse rounded-3xl bg-muted" aria-label="Carregando resumo" />}
      {accounts.isSuccess && accounts.data.length === 0 && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <div><h2 className="font-semibold">Comece cadastrando uma conta</h2><p className="mt-1 text-sm text-muted-foreground">Depois, registre sua primeira movimentação para acompanhar o saldo.</p></div>
          <Link to="/contas" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Cadastrar conta</Link>
        </section>
      )}

      {/* Saldo disponível and Evolução financeira, as on the phone; the painel comes right after. */}
      {data ? (
        <section className="min-w-0 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6" data-testid="dashboard-web-hero">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <BalanceHeroCard total={data.total_balance} onOpen={() => go("balance")} />
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Tipo de gráfico" value={chartView} onChange={(e) => setChartView(e.target.value as typeof chartView)} className="h-9 rounded-full border border-border bg-background px-3 text-sm">
                <option value="Projeção">Projeção</option><option value="Linhas">Linhas</option><option value="Barras">Barras</option><option value="Pizza">Pizza</option>
              </select>
              <select aria-label="Período do gráfico" value={chartPeriod} onChange={(e) => setChartPeriod(e.target.value)} className="h-9 rounded-full border border-border bg-background px-3 text-sm">
                <option>7 dias</option><option>1 mês</option><option>3 meses</option><option>6 meses</option><option>1 ano</option>
              </select>
              <Link to={`/transacoes?aba=caixa&month=${month}`} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:bg-muted">Caixa <ArrowRight size={14} /></Link>
            </div>
          </div>
          <div className="mt-5">
            <h2 className="font-heading text-base font-semibold">Evolução financeira</h2>
            <p className="text-xs text-muted-foreground">{chartView === "Projeção" ? "Saldo real até hoje e estimativa até o fim do mês" : "Receitas, despesas e resultado"}</p>
            <div className="mt-2">
              <HomeFinancialChart month={data.month} total={data.total_balance} income={data.income} expense={data.expense} result={data.month_balance} onOpenMetric={go} menuView={chartView} menuInterval={chartPeriod} menuSeries={["Receitas", "Despesas", "Resultado"]} bare />
            </div>
          </div>
        </section>
      ) : null}

      <PendingCaptures limit={HOME_LIMIT} />
      <WidgetBoard surface="inicio" header={<h2 className="font-heading text-lg font-semibold">Seu painel</h2>} />
    </div>
  );
}
