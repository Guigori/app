import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { fetchTrends } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MetricKind } from "@/types/finnos";

interface MetricChartsProps {
  month: string;
  income: number;
  expense: number;
  monthBalance: number;
  invested: number;
  /** Same destination as the cards: the full /fluxo screen for that metric. */
  onOpenMetric: (metric: MetricKind) => void;
}

const SERIES: Array<{ metric: MetricKind; label: string; pick: "income" | "expense" | "net" }> = [
  { metric: "income", label: "Receitas", pick: "income" },
  { metric: "expense", label: "Despesas", pick: "expense" },
  { metric: "balance", label: "Saldo do mês", pick: "net" },
  { metric: "invested", label: "Investimentos", pick: "net" },
];

/** The charts alternative to SummaryCards — same four metrics, drawn as 6-month bars. */
export function MetricCharts({ month, income, expense, monthBalance, invested, onOpenMetric }: MetricChartsProps) {
  const { hidden } = useBalanceHidden();
  const trendsQuery = useQuery({ queryKey: ["trends", month], queryFn: () => fetchTrends(6, month) });
  const months = trendsQuery.data?.months ?? [];
  const values: Record<MetricKind, number> = { income, expense, balance: monthBalance, invested };
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="home-metric-charts">
      {SERIES.map((item) => {
        const data =
          item.metric === "invested"
            ? []
            : months.map((m) => ({
                label: m.label,
                value: item.pick === "income" ? m.income : item.pick === "expense" ? m.expense : m.net,
              }));
        return (
          <Card key={item.metric} className="py-0" data-testid={`metric-chart-${item.metric}`}>
            <CardContent className="p-0">
              <button
                type="button"
                onClick={() => onOpenMetric(item.metric)}
                className="w-full rounded-2xl p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label={`Abrir o fluxo de ${item.label}`}
                data-testid={`metric-chart-open-${item.metric}`}
              >
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {item.label}
                  {item.metric === "invested" ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      Em breve
                    </Badge>
                  ) : null}
                </p>
                <p
                  className={cn(
                    "mt-1 font-heading text-2xl font-bold tabular-nums text-foreground",
                    item.metric === "balance" ? (monthBalance >= 0 ? "text-income" : "text-expense") : undefined,
                  )}
                  data-testid={`metric-chart-${item.metric}-value`}
                >
                  {money(values[item.metric])}
                </p>
                <div className="mt-3 h-20 w-full">
                  {data.length === 0 ? (
                    <p className="flex h-full items-center text-xs text-muted-foreground">
                      {item.metric === "invested" ? "Módulo em preparação" : "Sem histórico ainda"}
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                        <Tooltip
                          cursor={{ fill: "var(--muted)" }}
                          contentStyle={{
                            background: "var(--popover)",
                            border: "1px solid var(--border)",
                            borderRadius: 12,
                            color: "var(--popover-foreground)",
                            fontSize: 12,
                          }}
                          formatter={(value: number) => [formatBRL(value), item.label]}
                        />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={18}>
                          {data.map((entry, index) => (
                            <Cell
                              key={`${entry.label}-${index}`}
                              fill={
                                item.pick === "income"
                                  ? "var(--income)"
                                  : item.pick === "expense"
                                    ? "var(--expense)"
                                    : entry.value >= 0
                                      ? "var(--income)"
                                      : "var(--expense)"
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
