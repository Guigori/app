import { BackupReminder } from "@/components/settings/BackupReminder";
import { useRouteState } from "@/lib/routeState";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchOnboarding } from "@/lib/onboarding";
import { getMode } from "@/lib/mode";
import { useBalanceHidden } from "@/lib/balance";
import { fetchAccounts, fetchDashboard, fetchMe } from "@/lib/data";
import { WidgetBoard } from "@/components/insights/WidgetBoard";
import { currentMonth, firstName, monthLabel } from "@/lib/format";

import { CHART_RANGES, pickMany, pickOne, useChartPreference } from "@/lib/chartPreferences";
import type { MetricKind } from "@/types/finnos";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BalanceHeroCard } from "@/components/dashboard/BalanceHeroCard";
import { HomeFinancialChart } from "@/components/dashboard/HomeFinancialChart";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";

import { FinnosVerticalMenu, type FinnosView, type FinnosSeries } from "@/components/shared/FinnosVerticalMenu";

const CHART_VIEWS: FinnosView[] = ["Cards", "Projeção", "Linhas", "Pizza", "Barras"];
const ALL_CHART_SERIES: FinnosSeries[] = ["Receitas", "Despesas", "Resultado"];
import { PendingCaptures } from "@/components/pending/PendingCaptures";
import { HOME_LIMIT } from "@/lib/pendingCaptures";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const METRIC_TAB: Record<MetricKind, string> = {
  income: "receitas",
  expense: "despesas",
  balance: "caixa",
  invested: "projecao",
};

export default function Dashboard() {
  const dialogs = useDialogs();
  const onboardingQuery = useQuery({ queryKey: ["onboarding"], queryFn: fetchOnboarding, enabled: getMode() === "account" });
  const needsSetup = ["skipped", "not_started", "in_progress"].includes(onboardingQuery.data?.status ?? "");
  const navigate = useNavigate();
  const { hidden: balanceHidden, toggle: toggleBalance } = useBalanceHidden();
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 5 * 60 * 1000,
  });
  const [month, setMonth] = useRouteState<string | null>("inicio:month", null);
  // How the chart was left: kept on the device and in the account, so it opens the same way.
  const [menuView, setMenuView] = useChartPreference<FinnosView>("view", (v) => pickOne(v, CHART_VIEWS, "Projeção"));
  const [menuInterval, setMenuInterval] = useChartPreference<string>("interval", (v) => pickOne(v, CHART_RANGES, "1 mês"));
  const [menuSeries, setMenuSeries] = useChartPreference<FinnosSeries[]>("series", (v) => pickMany(v, ALL_CHART_SERIES, [...ALL_CHART_SERIES]));
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", month],
    queryFn: () => fetchDashboard(month),
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
    staleTime: 30_000,
  });

  const data = dashboardQuery.data;
  const error = dashboardQuery.error;
  const noAccounts = accountsQuery.isSuccess && accountsQuery.data.length === 0;
  const activeMonth = data?.month ?? currentMonth();

  // Every card/chart opens the full Fluxo screen (never a side panel), so the browser
  // back gesture returns to the Home exactly where it was.
  const openFlow = (metric: MetricKind) =>
    navigate(`/transacoes?aba=caixa&month=${activeMonth}&metric=${METRIC_TAB[metric]}`);

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden animate-fade-up sm:space-y-6">
      {(needsSetup || (onboardingQuery.data?.status === "legacy" && noAccounts)) && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4" data-testid="onboarding-resume-banner"><div><p className="text-sm font-semibold">Sua configuração ainda não terminou</p><p className="mt-1 text-xs text-muted-foreground">Continue de onde parou, sem perder as informações que já cadastrou.</p></div><Link to="/onboarding" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Continuar configuração</Link></div>}
      <BackupReminder />
      {/* Minimal header: no tinted box around the greeting, balance and chart. */}
      <section className="relative min-w-0 pt-1" data-testid="dashboard-financial-header">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 pr-24">
          <h1
            className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
            data-testid="dashboard-greeting"
          >
            Olá, {user ? firstName(user.name) : "tudo bem?"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="dashboard-subtitle">
            Visão geral de {monthLabel(activeMonth)}
          </p>
        </div>
        <div className="absolute -right-1 top-0 z-30" data-testid="dashboard-action-rail">
          <FinnosVerticalMenu month={activeMonth} onMonthChange={setMonth} hidden={balanceHidden} onToggleHidden={toggleBalance} view={menuView} onViewChange={setMenuView} interval={menuInterval} onIntervalChange={setMenuInterval} series={menuSeries} onSeriesChange={setMenuSeries} />
        </div>
      </div>

      {data ? (
        <div className="mt-5 pb-2 sm:mt-7">
          <BalanceHeroCard
            total={data.total_balance}
            onOpen={() => openFlow("balance")}
          />
          <div className="mt-6">
            <HomeFinancialChart
              month={data.month}
              total={data.total_balance}
              income={data.income}
              expense={data.expense}
              result={data.month_balance}
              onOpenMetric={openFlow}
              menuView={menuView}
              menuInterval={menuInterval}
              menuSeries={menuSeries}
            />
          </div>
        </div>
      ) : null}
      </section>

      {/* Apple Pay purchases waiting for "registrar" or "excluir": nothing here when there are none. */}
      <PendingCaptures limit={HOME_LIMIT} />

      {error && !data ? (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground" data-testid="dashboard-error-message">
              Não foi possível carregar seus dados financeiros. Verifique sua conexão e tente novamente.
            </p>
            <Button variant="outline" onClick={() => dashboardQuery.refetch()} data-testid="dashboard-retry-button">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {dashboardQuery.isPending && !data ? (
        <FinnosPageLoading title="Carregando visão geral" description="Preparando seu resumo financeiro do mês." />
      ) : null}

      {noAccounts && !error ? (
        <div
          className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between"
          data-testid="onboarding-card"
        >
          <div>
            <p className="font-heading text-base font-semibold text-foreground">Comece com uma conta bancária</p>
            <p className="text-sm text-muted-foreground">
              Cadastre uma conta e registre a primeira movimentação para o painel ganhar vida.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link to="/contas" className={buttonVariants({ variant: "outline" })} data-testid="onboarding-create-account-link">
              Cadastrar conta
            </Link>
            <Button onClick={() => dialogs.openTransaction()} data-testid="onboarding-add-transaction-button">
              Adicionar transação
            </Button>
          </div>
        </div>
      ) : null}

      {data ? (
        <div className="min-w-0 space-y-5 sm:space-y-6">
          <WidgetBoard surface="inicio" header={<h2 className="font-heading text-lg font-semibold">Seu painel</h2>} />
        </div>
      ) : !error ? (
        <div className="space-y-6" aria-hidden="true">
          <div className="h-56 animate-pulse rounded-3xl bg-muted" />
          <div className="h-72 animate-pulse rounded-3xl bg-muted" />
        </div>
      ) : null}
    </div>
  );
}
