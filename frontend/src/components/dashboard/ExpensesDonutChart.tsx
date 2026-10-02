import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, monthLabel } from "@/lib/format";
import type { CategorySlice } from "@/types/finnos";

interface ExpensesDonutChartProps {
  month: string;
  slices: CategorySlice[];
  total: number;
}

export function ExpensesDonutChart({ month, slices, total }: ExpensesDonutChartProps) {
  const { hidden } = useBalanceHidden();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Para onde foi</CardTitle>
        <CardDescription>Distribuição das despesas de {monthLabel(month)}</CardDescription>
      </CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <EmptyState
            title="Nenhuma despesa neste mês"
            description="Quando houver despesas, o gráfico mostra para onde seu dinheiro está indo."
          />
        ) : (
          <div className="flex flex-col items-center gap-6 sm:flex-row">
            <div className="relative h-48 w-48 shrink-0" data-testid="expenses-donut-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="total"
                    nameKey="name"
                    innerRadius="68%"
                    outerRadius="98%"
                    paddingAngle={2}
                    cornerRadius={6}
                    strokeWidth={0}
                  >
                    {slices.map((slice) => (
                      <Cell key={slice.category_id ?? slice.name} fill={slice.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-xs text-muted-foreground">Total gasto</p>
                <p className="font-heading text-xl font-bold tabular-nums text-foreground" data-testid="donut-total-value">
                  {hidden ? formatHiddenBRL() : formatBRL(total)}
                </p>
              </div>
            </div>
            <ul className="w-full space-y-2.5">
              {slices.slice(0, 6).map((slice) => (
                <li key={slice.category_id ?? slice.name} className="flex items-center gap-3" data-testid="donut-legend-item">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{slice.name}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{hidden ? "••••" : formatBRL(slice.total)}</span>
                  <span className="w-12 text-right text-sm font-semibold tabular-nums text-foreground">
                    {Math.round(slice.percent)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
