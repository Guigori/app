import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, LayoutGrid } from "lucide-react";
import { fetchAccounts, fetchDashboard, fetchMe, fetchTransactions } from "@/lib/data";
import { currentMonth, firstName, monthLabel } from "@/lib/format";
import { useHomeView } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import type { CategorySlice, MetricKind } from "@/types/finnos";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BalanceHeroCard } from "@/components/dashboard/BalanceHeroCard";
import { BalanceComparisonHeroCard } from "@/components/dashboard/BalanceComparisonHeroCard";
import { Budget503020Card } from "@/components/dashboard/Budget503020Card";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { ExpensesDonutChart } from "@/components/dashboard/ExpensesDonutChart";
import { MetricCharts } from "@/components/dashboard/MetricCharts";
import { MonthSelector } from "@/components/dashboard/MonthSelector";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
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
  const { view, setView } = useHomeView();
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
  const categoryTransactionsQuery = useQuery({
    queryKey: ["dashboard-category-transactions", activeMonth, selectedCategory?.category_id],
    queryFn: () => fetchTransactions({ month: activeMonth, type: "despesa", category_id: selectedCategory?.category_id ?? undefined }),
    enabled: Boolean(selectedCategory?.category_id),
  });
  const visibleRecent = selectedCategory
    ? (categoryTransactionsQuery.data ?? []).slice(0, 6)
    : (data?.recent ?? []);

  // Every card/chart opens the full Fluxo screen (never a side panel), so the browser
  // back gesture returns to the Home exactly where it was.
  const openFlow = (metric: MetricKind) =>
    navigate(`/fluxo?month=${activeMonth}&metric=${METRIC_TAB[metric]}`);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
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
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex gap-1 rounded-full border border-border bg-muted/60 p-1"
            role="group"
            aria-label="Como ver o resumo"
          >
            {([
              { key: "cards" as const, label: "Cards", icon: LayoutGrid },
              { key: "graficos" as const, label: "Gráficos", icon: BarChart3 },
            ]).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setView(option.key)}
                aria-pressed={view === option.key}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150",
                  view === option.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`home-view-${option.key}`}
              >
                <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {option.label}
              </button>
            ))}
          </div>
          {data ? <MonthSelector month={data.month} onChange={setMonth} /> : null}
        </div>
      </div>

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
        <div className="space-y-6">
          {view === "cards" ? (
            <BalanceHeroCard
              month={data.month}
              total={data.total_balance}
              income={data.income}
              expense={data.expense}
              onOpen={() => openFlow("balance")}
            />
          ) : (
            <BalanceComparisonHeroCard
              month={data.month}
              total={data.total_balance}
              income={data.income}
              expense={data.expense}
              onOpen={() => openFlow("balance")}
              onOpenIncome={() => openFlow("income")}
              onOpenExpense={() => openFlow("expense")}
            />
          )}

          {view === "cards" ? (
            <SummaryCards
              income={data.income}
              expense={data.expense}
              monthBalance={data.month_balance}
              invested={data.invested}
              prevIncome={data.prev_income}
              prevExpense={data.prev_expense}
              onOpenMetric={openFlow}
            />
          ) : (
            <MetricCharts
              month={data.month}
              income={data.income}
              expense={data.expense}
              monthBalance={data.month_balance}
              invested={data.invested}
              onOpenMetric={openFlow}
            />
          )}

          <div>
            <ExpensesDonutChart
              month={data.month}
              slices={data.categories}
              total={data.expense}
              onOpenDetails={() => openFlow("expense")}
              selectedCategoryId={selectedCategory?.category_id ?? null}
              onSelectCategory={setSelectedCategory}
              onOpenCategory={(slice) =>
                navigate(`/fluxo?month=${activeMonth}&metric=despesas&category_id=${encodeURIComponent(slice.category_id ?? "")}`)
              }
            />
          </div>

          <RecentTransactions
            transactions={visibleRecent}
            categoryName={selectedCategory?.name ?? null}
            month={data.month}
            categoryId={selectedCategory?.category_id ?? null}
          />
          <Budget503020Card month={monthLabel(data.month)} income={data.income} rule={data.rule} />
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
