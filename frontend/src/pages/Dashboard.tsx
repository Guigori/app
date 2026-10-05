import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, SlidersHorizontal } from "lucide-react";
import { useBalanceHidden } from "@/lib/balance";
import { fetchAccounts, fetchDashboard, fetchMe, fetchRadar, fetchTransactions } from "@/lib/data";
import { currentMonth, firstName, monthLabel } from "@/lib/format";

import { useHomePreferences, type HomeModuleId } from "@/lib/homePreferences";
import { cn } from "@/lib/utils";
import type { CategorySlice, MetricKind } from "@/types/finnos";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BalanceHeroCard } from "@/components/dashboard/BalanceHeroCard";
import { HomeFinancialChart } from "@/components/dashboard/HomeFinancialChart";
import { Budget503020Card } from "@/components/dashboard/Budget503020Card";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { ExpensesDonutChart } from "@/components/dashboard/ExpensesDonutChart";

import { MonthSelector } from "@/components/dashboard/MonthSelector";
import { RadarSection } from "@/components/dashboard/RadarSection";

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
  const navigate = useNavigate();
  const homePreferences = useHomePreferences();
  const { hidden: balanceHidden, toggle: toggleBalance } = useBalanceHidden();
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 5 * 60 * 1000,
  });
  const [month, setMonth] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategorySlice | null>(null);
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
  const noAccounts = !accountsQuery.isPending && (accountsQuery.data ?? []).length === 0;
  const activeMonth = data?.month ?? currentMonth();
  const radarQuery = useQuery({
    queryKey: ["radar", activeMonth],
    queryFn: fetchRadar,
    staleTime: 60_000,
  });
  const categoryTransactionsQuery = useQuery({
    queryKey: ["dashboard-category-transactions", activeMonth, selectedCategory?.category_id],
    queryFn: () => fetchTransactions({ type: "despesa", category_id: selectedCategory?.category_id ?? undefined }),
    enabled: Boolean(selectedCategory?.category_id),
  });
  const visibleRecent = selectedCategory
    ? (categoryTransactionsQuery.data ?? [])
        .filter((tx) => {
          if (tx.status !== "pago") return false;
          if (!tx.installment) return tx.date.slice(0, 7) === activeMonth;
          const [startYear, startMonth] = tx.date.slice(0, 7).split("-").map(Number);
          const [activeYear, activeMonthNumber] = activeMonth.split("-").map(Number);
          const offset = (activeYear - startYear) * 12 + (activeMonthNumber - startMonth);
          return offset >= 0 && offset < (tx.total_installments ?? 1);
        })
        .slice(0, 6)
    : (data?.recent ?? []);

  // Every card/chart opens the full Fluxo screen (never a side panel), so the browser
  // back gesture returns to the Home exactly where it was.
  const openFlow = (metric: MetricKind) =>
    navigate(`/fluxo?month=${activeMonth}&metric=${METRIC_TAB[metric]}`);

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden animate-fade-up sm:space-y-6">
      <section className="dashboard-hero-surface relative min-w-0 rounded-[24px] border border-border/70 px-4 pb-6 pt-6 shadow-sm sm:rounded-[28px] sm:px-6 sm:pb-7 sm:pt-7" data-testid="dashboard-financial-header">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 pr-12 sm:pr-14">
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
        <div className="absolute right-0 top-6 z-20 flex shrink-0 flex-col items-center gap-1 sm:right-0 sm:top-7" data-testid="dashboard-action-rail">
          {data ? <MonthSelector month={data.month} onChange={setMonth} /> : null}
          <Button variant="ghost" size="icon" onClick={toggleBalance} aria-label={balanceHidden ? "Exibir valores" : "Ocultar valores"} data-testid="dashboard-visibility-toggle" className="h-10 w-10 rounded-full hover:bg-muted/60">
            {balanceHidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </Button>
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
            />
          </div>
        </div>
      ) : null}
      </section>

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
          {homePreferences.order.filter((id) => !homePreferences.hidden.includes(id)).map((moduleId: HomeModuleId) => {
            if (moduleId === "metrics") return null;
            if (moduleId === "radar") return <RadarSection key={moduleId} signals={radarQuery.data?.items ?? []} totalCount={radarQuery.data?.count ?? 0} />;
            if (moduleId === "categories") return (
              <div key={moduleId}>
                <ExpensesDonutChart
                  month={data.month}
                  slices={data.categories}
                  total={data.expense}
                  transactions={visibleRecent}
                  onOpenDetails={() => openFlow("expense")}
                  onOpenAllTransactions={() =>
                    navigate(
                      selectedCategory?.category_id
                        ? `/fluxo?month=${activeMonth}&metric=despesas&category_id=${encodeURIComponent(selectedCategory.category_id)}`
                        : `/fluxo?month=${activeMonth}`,
                    )
                  }
                  selectedCategoryId={selectedCategory?.category_id ?? null}
                  onSelectCategory={setSelectedCategory}
                  onOpenCategory={(slice) => navigate(`/fluxo?month=${activeMonth}&metric=despesas&category_id=${encodeURIComponent(slice.category_id ?? "")}`)}
                />
              </div>
            );
            if (moduleId === "budget") return <Budget503020Card key={moduleId} month={monthLabel(data.month)} income={data.income} rule={data.rule} />;
            return null;
          })}

          <div className="flex justify-center pb-2 pt-2">
            <Link
              to="/configuracoes#home-panel"
              className={cn(buttonVariants({ variant: "outline" }), "rounded-full border-border/70 bg-card/70 px-5 shadow-sm backdrop-blur-xl")}
              data-testid="modify-dashboard-button"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Modificar painel
            </Link>
          </div>
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
