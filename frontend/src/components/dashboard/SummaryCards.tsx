import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MetricKind } from "@/types/finnos";

interface SummaryCardsProps {
  income: number;
  expense: number;
  monthBalance: number;
  invested: number;
  prevIncome: number | null;
  prevExpense: number | null;
  /** Opens the metric's charts — the cards are the entry point to the detail panel. */
  onOpenMetric: (metric: MetricKind) => void;
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

export function SummaryCards({
  income,
  expense,
  monthBalance,
  invested,
  prevIncome,
  prevExpense,
  onOpenMetric,
}: SummaryCardsProps) {
  const { hidden } = useBalanceHidden();
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));
  const retainedPercent = income > 0 ? Math.round((monthBalance / income) * 100) : null;
  const expenseShare = income > 0 ? Math.round((expense / income) * 100) : null;

  const cards: Array<{
    metric: MetricKind;
    label: string;
    value: number;
    valueClass?: string;
    footer: React.ReactNode;
    badge?: boolean;
  }> = [
    {
      metric: "income",
      label: "Receitas",
      value: income,
      footer: <Trend current={income} previous={prevIncome} />,
    },
    {
      metric: "expense",
      label: "Despesas",
      value: expense,
      footer: (
        <div className="space-y-0.5">
          <Trend current={expense} previous={prevExpense} goodWhenDown />
          {expenseShare !== null ? <p className="text-xs text-muted-foreground">{expenseShare}% da receita foi comprometida</p> : null}
        </div>
      ),
    },
    {
      metric: "balance",
      label: "Saldo do mês",
      value: monthBalance,
      valueClass: monthBalance >= 0 ? "text-income" : "text-expense",
      footer: (
        <p className="text-xs text-muted-foreground">
          {retainedPercent !== null
            ? monthBalance >= 0
              ? `${Math.max(retainedPercent, 0)}% da receita permaneceu disponível`
              : `As despesas superaram a receita em ${Math.abs(retainedPercent)}%`
            : "Receitas menos despesas"}
        </p>
      ),
    },
    {
      metric: "invested",
      label: "Investimentos",
      value: invested,
      footer: <p className="text-xs text-muted-foreground">Módulo em preparação</p>,
      badge: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
      {cards.map((card) => (
        <Card
          key={card.metric}
          className="group py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          data-testid={`summary-card-${card.metric}`}
        >
          <CardContent className="p-0">
            <button
              type="button"
              onClick={() => onOpenMetric(card.metric)}
              className="min-w-0 w-full overflow-hidden rounded-2xl px-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={`Ver gráficos de ${card.label}`}
              data-testid={`summary-open-${card.metric}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {card.label}
                  {card.badge ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Em breve</Badge>
                  ) : null}
                </p>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </div>
              <p
                className={cn(
                  "mt-1.5 whitespace-nowrap font-heading text-[clamp(1.05rem,4.8vw,1.5rem)] font-bold tracking-tight tabular-nums text-foreground",
                  card.valueClass,
                )}
                data-testid={`summary-${card.metric}-value`}
              >
                {money(card.value)}
              </p>
              <div className="mt-1.5">{card.footer}</div>
            </button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
