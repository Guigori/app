import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAccounts, fetchDashboard, fetchMe } from "@/lib/data";
import { currentMonth, firstName, monthLabel } from "@/lib/format";
import type { Account, Dashboard as DashboardData } from "@/types/finnos";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BalanceHeroCard } from "@/components/dashboard/BalanceHeroCard";
import { Budget503020Card } from "@/components/dashboard/Budget503020Card";
import { ExpensesDonutChart } from "@/components/dashboard/ExpensesDonutChart";
import { MonthSelector } from "@/components/dashboard/MonthSelector";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Dashboard() {
  const dialogs = useDialogs();
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 5 * 60 * 1000,
  });
  const [month, setMonth] = useState<string | null>(null);
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
            Visão geral de {data ? monthLabel(data.month) : monthLabel(currentMonth())}
          </p>
        </div>
        {data ? <MonthSelector month={data.month} onChange={setMonth} /> : null}
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <BalanceHeroCard month={data.month} total={data.total_balance} income={data.income} expense={data.expense} />
          </div>
          <div className="lg:col-span-4">
            <SummaryCards
              income={data.income}
              expense={data.expense}
              monthBalance={data.month_balance}
              invested={data.invested}
              prevIncome={data.prev_income}
              prevExpense={data.prev_expense}
            />
          </div>
          <div className="lg:col-span-7">
            <Budget503020Card month={monthLabel(data.month)} income={data.income} rule={data.rule} />
          </div>
          <div className="lg:col-span-5">
            <ExpensesDonutChart month={data.month} slices={data.categories} total={data.expense} />
          </div>
          <div className="lg:col-span-12">
            <RecentTransactions transactions={data.recent} />
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
