import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, monthLabel } from "@/lib/format";
import type { CategorySlice } from "@/types/finnos";

interface ExpensesDonutChartProps {
  month: string;
  slices: CategorySlice[];
  total: number;
  onOpenDetails?: () => void;
  selectedCategoryId?: string | null;
  onSelectCategory?: (slice: CategorySlice | null) => void;
  onOpenCategory?: (slice: CategorySlice) => void;
}

export function ExpensesDonutChart({ month, slices, total, onOpenDetails, selectedCategoryId = null, onSelectCategory, onOpenCategory }: ExpensesDonutChartProps) {
  const { hidden } = useBalanceHidden();
  const selected = selectedCategoryId ? slices.find((slice) => slice.category_id === selectedCategoryId) ?? null : null;
  const visibleSlices = selected ? [selected] : slices;
  const displayTotal = selected?.total ?? total;


  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="font-heading">Pra onde foi o dinheiro?</CardTitle>
          <CardDescription>
            {slices.length > 0
              ? `${monthLabel(month)} · ${slices.length} ${slices.length === 1 ? "categoria" : "categorias"}`
              : `Distribuição das despesas de ${monthLabel(month)}`}
          </CardDescription>
        </div>
        {slices.length > 0 && onOpenDetails ? (
          <Button variant="ghost" size="sm" onClick={onOpenDetails} data-testid="donut-open-details-button">
            Detalhes
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <EmptyState
            title="Nenhuma despesa neste mês"
            description="Quando houver despesas, o gráfico mostra para onde seu dinheiro está indo."
          />
        ) : (
          <div className="flex flex-col items-center gap-6 sm:flex-row">
            <div className="relative h-48 w-48 shrink-0" data-testid="expenses-donut-chart" onClick={(event) => { if (event.target === event.currentTarget) onSelectCategory?.(null); }}>
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
                    onClick={(_, index) => {
                      const slice = slices[index];
                      if (slice) onSelectCategory?.(selected?.category_id === slice.category_id ? null : slice);
                    }}
                  >
                    {slices.map((slice) => (
                      <Cell
                        key={slice.category_id ?? slice.name}
                        fill={slice.color}
                        opacity={selected && slice.category_id !== selected.category_id ? 0.14 : 1}
                        className={onSelectCategory ? "cursor-pointer" : undefined}
                      />
                    ))}
                  </Pie>
                  {slices.map((slice, index) => {
                    if (slice.percent < 4) return null;
                    const totalValue = slices.reduce((sum, item) => sum + item.total, 0);
                    const before = slices.slice(0, index).reduce((sum, item) => sum + item.total, 0);
                    const mid = ((before + slice.total / 2) / totalValue) * Math.PI * 2 - Math.PI / 2;
                    const radius = 80;
                    const x = 96 + Math.cos(mid) * radius - 10;
                    const y = 96 + Math.sin(mid) * radius - 10;
                    return (
                      <foreignObject key={`icon-${slice.category_id ?? slice.name}`} x={x} y={y} width={20} height={20} className="pointer-events-none overflow-visible">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-background/90" style={{ color: slice.color }}>
                          <CategoryIcon name={slice.icon ?? "more-horizontal"} className="h-3.5 w-3.5" />
                        </div>
                      </foreignObject>
                    );
                  })}
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-xs text-muted-foreground">{selected ? selected.name : "Total gasto"}</p>
                <p className="font-heading text-xl font-bold tabular-nums text-foreground" data-testid="donut-total-value">
                  {hidden ? formatHiddenBRL() : formatBRL(displayTotal)}
                </p>
              </div>
            </div>
            <ul className="w-full space-y-2.5">
              {visibleSlices.slice(0, 6).map((slice) => (
                <li
                  key={slice.category_id ?? slice.name}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
                  onClick={() => onSelectCategory?.(selected?.category_id === slice.category_id ? null : slice)}
                  data-testid="donut-legend-item"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenCategory?.(slice);
                    }}
                    aria-label={`Abrir despesas de ${slice.name} em ${monthLabel(month)}`}
                  >
                    {slice.name}
                  </button>
                  <span className="text-sm tabular-nums text-muted-foreground">{hidden ? "••••" : formatBRL(slice.total)}</span>
                  <span className="w-12 text-right text-sm font-semibold tabular-nums text-foreground">
                    {Math.round(slice.percent)}%
                  </span>
                </li>
              ))}
            </ul>
            {selected ? (
              <button
                type="button"
                onClick={() => onSelectCategory?.(null)}
                className="mt-1 text-xs font-semibold text-primary hover:underline"
                data-testid="donut-show-all-categories"
              >
                Ver todas as categorias
              </button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
