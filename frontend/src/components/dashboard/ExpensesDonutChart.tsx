import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL, formatSignedBRL, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CategorySlice, Transaction } from "@/types/finnos";

interface ExpensesDonutChartProps {
  month: string;
  slices: CategorySlice[];
  total: number;
  onOpenDetails?: () => void;
  selectedCategoryId?: string | null;
  onSelectCategory?: (slice: CategorySlice | null) => void;
  onOpenCategory?: (slice: CategorySlice) => void;
  transactions?: Transaction[];
  onOpenAllTransactions?: () => void;
}

export function ExpensesDonutChart({ month, slices, total, onOpenDetails, selectedCategoryId = null, onSelectCategory, onOpenCategory, transactions, onOpenAllTransactions }: ExpensesDonutChartProps) {
  const dialogs = useDialogs();
  const { hidden } = useBalanceHidden();
  const selected = selectedCategoryId ? slices.find((slice) => slice.category_id === selectedCategoryId) ?? null : null;
  const visibleSlices = selected ? [selected] : slices;
  const displayTotal = selected?.total ?? total;


  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
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
          <div className="flex min-w-0 flex-col items-center gap-5 sm:flex-row sm:gap-6">
            <div className="relative h-44 w-44 shrink-0 min-[390px]:h-48 min-[390px]:w-48" data-testid="expenses-donut-chart" onClick={(event) => { if (event.target === event.currentTarget) onSelectCategory?.(null); }}>
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
                        opacity={selected && slice.category_id !== selected.category_id ? 0.22 : 1}
                        className={onSelectCategory ? "cursor-pointer" : undefined}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-xs text-muted-foreground">{selected ? selected.name : "Total gasto"}</p>
                <p className="max-w-[9rem] overflow-hidden text-ellipsis whitespace-nowrap font-heading text-lg font-bold tabular-nums text-foreground min-[390px]:text-xl" data-testid="donut-total-value">
                  {hidden ? formatHiddenBRL() : formatBRL(displayTotal)}
                </p>
              </div>
            </div>
            <ul className="min-w-0 w-full space-y-2.5">
              {visibleSlices.slice(0, 6).map((slice) => (
                <li
                  key={slice.category_id ?? slice.name}
                  className="grid min-w-0 cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg px-1 py-1.5 transition-colors hover:bg-muted/50 min-[390px]:gap-3 min-[390px]:px-2"
                  onClick={() => onSelectCategory?.(selected?.category_id === slice.category_id ? null : slice)}
                  data-testid="donut-legend-item"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: slice.color + "1A", color: slice.color }}
                    aria-hidden="true"
                  >
                    <CategoryIcon name={slice.icon ?? "more-horizontal"} className="h-4 w-4" />
                  </span>
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
                  <span className="max-w-[6.5rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs tabular-nums text-muted-foreground min-[390px]:text-sm">{hidden ? "••••" : formatBRL(slice.total)}</span>
                  <span className="w-10 text-right text-xs font-semibold tabular-nums text-foreground min-[390px]:w-12 min-[390px]:text-sm">
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
            {transactions ? (
              <div className="mt-6 border-t border-border pt-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-heading text-base font-semibold text-foreground">
                      {selected ? `Transações · ${selected.name}` : "Transações recentes"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selected ? "Movimentações que formam esta categoria" : "Últimas movimentações do período"}
                    </p>
                  </div>
                  {onOpenAllTransactions ? (
                    <button
                      type="button"
                      onClick={onOpenAllTransactions}
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Ver todas <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                {transactions.length === 0 ? (
                  <p className="rounded-2xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                    Nenhuma transação encontrada para esta seleção.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {transactions.slice(0, 6).map((transaction) => {
                      const signed = transaction.type === "receita"
                        ? transaction.value
                        : transaction.type === "despesa"
                          ? -transaction.value
                          : 0;
                      return (
                        <li
                          key={transaction.id}
                          className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg py-3 transition-colors hover:bg-muted/40"
                          onClick={() => dialogs.openTransaction({ transaction })}
                        >
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                            style={{ backgroundColor: (transaction.category_color ?? "#64748B") + "1A", color: transaction.category_color ?? "#64748B" }}
                            aria-hidden="true"
                          >
                            <CategoryIcon name={transaction.category_icon ?? "more-horizontal"} className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{transaction.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[transaction.category_name ?? "Sem categoria", transaction.account_name].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={cn(
                              "text-sm font-semibold tabular-nums",
                              transaction.type === "receita" ? "text-income" : transaction.type === "despesa" ? "text-expense" : "text-transfer",
                            )}>
                              {hidden ? formatHiddenBRL() : transaction.type === "transferencia" ? formatBRL(transaction.value) : formatSignedBRL(signed)}
                            </p>
                            <p className="text-xs text-muted-foreground">{formatDate(transaction.date)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}

          </div>
        )}
      </CardContent>
    </Card>
  );
}
