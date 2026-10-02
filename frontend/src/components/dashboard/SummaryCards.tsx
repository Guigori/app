import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  income: number;
  expense: number;
  monthBalance: number;
  invested: number;
  prevIncome: number | null;
  prevExpense: number | null;
}

function Trend({ current, previous, goodWhenDown }: { current: number; previous: number | null; goodWhenDown?: boolean }) {
  if (previous === null || previous === 0) {
    return <p className="text-xs text-muted-foreground">Sem base de comparação ainda</p>;
  }
  const delta = ((current - previous) / previous) * 100;
  if (!Number.isFinite(delta)) return <p className="text-xs text-muted-foreground">Sem base de comparação ainda</p>;
  const up = delta >= 0;
  const good = goodWhenDown ? !up : up;
  return (
    <p className={cn("text-xs font-medium", good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
      {up ? "↑" : "↓"} {Math.abs(Math.round(delta))}% comparado ao mês anterior
    </p>
  );
}

export function SummaryCards({ income, expense, monthBalance, invested, prevIncome, prevExpense }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
      <Card className="py-4" data-testid="summary-card-income">
        <CardContent className="px-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Receitas</p>
          <p className="mt-1.5 font-heading text-2xl font-bold tabular-nums text-foreground" data-testid="summary-income-value">
            {formatBRL(income)}
          </p>
          <div className="mt-1.5">
            <Trend current={income} previous={prevIncome} />
          </div>
        </CardContent>
      </Card>

      <Card className="py-4" data-testid="summary-card-expense">
        <CardContent className="px-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Despesas</p>
          <p className="mt-1.5 font-heading text-2xl font-bold tabular-nums text-foreground" data-testid="summary-expense-value">
            {formatBRL(expense)}
          </p>
          <div className="mt-1.5">
            <Trend current={expense} previous={prevExpense} goodWhenDown />
          </div>
        </CardContent>
      </Card>

      <Card className="py-4" data-testid="summary-card-balance">
        <CardContent className="px-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Saldo do mês</p>
          <p
            className={cn(
              "mt-1.5 font-heading text-2xl font-bold tabular-nums",
              monthBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
            )}
            data-testid="summary-month-balance-value"
          >
            {formatBRL(monthBalance)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">Receitas menos despesas</p>
        </CardContent>
      </Card>

      <Card className="py-4" data-testid="summary-card-invested">
        <CardContent className="px-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Investimentos
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Em breve</Badge>
          </p>
          <p className="mt-1.5 font-heading text-2xl font-bold tabular-nums text-foreground" data-testid="summary-invested-value">
            {formatBRL(invested)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">Módulo em preparação</p>
        </CardContent>
      </Card>
    </div>
  );
}
