import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { fetchTrends } from "@/lib/data";
import { formatBRL, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CategorySlice, MetricKind } from "@/types/finnos";
import { CashflowTable } from "@/components/analytics/CashflowTable";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const META: Record<MetricKind, { title: string; description: string; bar: "income" | "expense" | "net" }> = {
  income: { title: "Receitas", description: "Quanto entrou, mês a mês", bar: "income" },
  expense: { title: "Despesas", description: "Quanto saiu e para onde foi", bar: "expense" },
  balance: { title: "Saldo do mês", description: "O que cada mês faz com o seu caixa", bar: "net" },
  invested: { title: "Investimentos", description: "Módulo em preparação", bar: "net" },
};

interface MetricDetailSheetProps {
  metric: MetricKind | null;
  month: string;
  categories: CategorySlice[];
  onClose: () => void;
}

export function MetricDetailSheet({ metric, month, categories, onClose }: MetricDetailSheetProps) {
  const open = metric !== null;
  const trendsQuery = useQuery({
    queryKey: ["trends", month],
    queryFn: () => fetchTrends(6, month),
    enabled: open,
  });

  const meta = metric ? META[metric] : null;
  const trends = trendsQuery.data;
  const chartData =
    trends?.months.map((m) => ({
      label: m.label,
      value: meta?.bar === "income" ? m.income : meta?.bar === "expense" ? m.expense : m.net,
    })) ?? [];

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-5 overflow-y-auto p-6 sm:max-w-lg">
        <SheetHeader className="text-left">
          <SheetTitle className="font-heading">{meta?.title ?? ""}</SheetTitle>
          <SheetDescription className="text-left">
            {meta?.description ?? ""} · {monthLabel(month)}
          </SheetDescription>
        </SheetHeader>

        {metric === "invested" ? (
          <div className="rounded-xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground" data-testid="metric-invested-soon">
            <Badge variant="secondary" className="mb-2">Em breve</Badge>
            <p>
              O módulo de investimentos (CDB, Tesouro, fundos, ações, ETF e cripto) entra em uma próxima
              entrega. Quando chegar, este painel mostrará valor aplicado x valor atual.
            </p>
          </div>
        ) : trendsQuery.isPending ? (
          <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
        ) : (
          <>
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Últimos 6 meses
              </h3>
              <div className="h-48 w-full" data-testid="metric-trend-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <Tooltip
                      cursor={{ fill: "var(--muted)" }}
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        color: "var(--popover-foreground)",
                        fontSize: 13,
                      }}
                      formatter={(value: number) => [formatBRL(value), meta?.title ?? ""]}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={38}>
                      {chartData.map((entry) => (
                        <Cell
                          key={entry.label}
                          fill={
                            meta?.bar === "income"
                              ? "var(--income)"
                              : meta?.bar === "expense"
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
              </div>
            </section>

            {trends ? (
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  O que cada mês faz com o caixa
                </h3>
                <CashflowTable months={trends.months} currentMonth={month} />
              </section>
            ) : null}

            {metric === "expense" ? (
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Para onde foi em {monthLabel(month)}
                </h3>
                {categories.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    Nenhuma despesa categorizada neste mês.
                  </p>
                ) : (
                  <ul className="space-y-2.5" data-testid="metric-category-list">
                    {categories.map((slice) => (
                      <li key={slice.category_id ?? slice.name} className="flex items-center gap-3">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                          style={{ backgroundColor: slice.color + "1A", color: slice.color }}
                          aria-hidden="true"
                        >
                          <CategoryIcon name={slice.icon} className="h-4.5 w-4.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-sm font-medium text-foreground">{slice.name}</p>
                            <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                              {formatBRL(slice.total)}
                            </p>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn("h-full rounded-full")}
                              style={{ width: `${Math.min(slice.percent, 100)}%`, backgroundColor: slice.color }}
                            />
                          </div>
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {Math.round(slice.percent)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
