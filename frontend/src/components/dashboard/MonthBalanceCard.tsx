import { Card, CardContent } from "@/components/ui/card";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MonthBalanceCardProps {
  income: number;
  expense: number;
  balance: number;
  prevExpense: number | null;
  onOpen?: () => void;
}

/** "Balanço do mês": the two vertical bars read at a glance — tall green = income,
 *  the red portion = how much of it went out. */
export function MonthBalanceCard({ income, expense, balance, prevExpense, onOpen }: MonthBalanceCardProps) {
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const max = Math.max(income, expense, 1);
  const incomeHeight = Math.max((income / max) * 100, income > 0 ? 8 : 2);
  const expenseHeight = Math.max((expense / max) * 100, expense > 0 ? 8 : 2);

  const delta =
    prevExpense && prevExpense > 0 ? Math.round(((expense - prevExpense) / prevExpense) * 100) : null;

  return (
    <Card
      className={cn("py-0", onOpen && "cursor-pointer transition-shadow duration-200 hover:shadow-md")}
      onClick={onOpen}
      data-testid="month-balance-card"
    >
      <CardContent className="flex items-center gap-5 p-5">
        <div className="flex h-28 shrink-0 items-end gap-2" aria-hidden="true">
          <div className="flex h-full w-5 items-end rounded-full bg-muted">
            <div className="w-full rounded-full bg-income transition-all duration-500" style={{ height: `${incomeHeight}%` }} />
          </div>
          <div className="flex h-full w-5 items-end rounded-full bg-muted">
            <div className="w-full rounded-full bg-expense transition-all duration-500" style={{ height: `${expenseHeight}%` }} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Balanço do mês</p>
          <dl className="mt-3 space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-foreground">Receitas</dt>
              <dd className="font-heading text-base font-bold tabular-nums text-income" data-testid="month-balance-income">
                {money(income)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-foreground">Despesas</dt>
              <dd className="font-heading text-base font-bold tabular-nums text-expense" data-testid="month-balance-expense">
                {money(expense)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
              <dt className="text-sm font-medium text-foreground">Balanço</dt>
              <dd
                className={cn(
                  "font-heading text-lg font-bold tabular-nums",
                  balance >= 0 ? "text-foreground" : "text-expense",
                )}
                data-testid="month-balance-net"
              >
                {money(balance)}
              </dd>
            </div>
          </dl>
          {delta !== null ? (
            <p
              className={cn(
                "mt-3 inline-block rounded-full px-3 py-1 text-xs font-medium",
                delta > 0 ? "bg-expense/10 text-expense" : "bg-income/10 text-income",
              )}
              data-testid="month-balance-delta"
            >
              Despesas {delta > 0 ? "+" : ""}
              {delta}% vs mês anterior
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Sem mês anterior para comparar</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
