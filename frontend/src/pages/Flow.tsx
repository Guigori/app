import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { fetchCategories, fetchFlow } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { addMonth, currentMonth, formatBRL, formatHiddenBRL, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MonthSelector } from "@/components/dashboard/MonthSelector";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FlowPeriod, FlowTab } from "@/types/finnos";

const TABS: Array<{ key: FlowTab; label: string }> = [
  { key: "receitas", label: "Receitas" },
  { key: "despesas", label: "Despesas" },
  { key: "caixa", label: "Caixa" },
  { key: "projecao", label: "Projeção" },
];

const PERIODS: Array<{ key: FlowPeriod; label: string }> = [
  { key: "3", label: "3 meses" },
  { key: "6", label: "6 meses" },
  { key: "12", label: "1 ano" },
  { key: "custom", label: "Personalizado" },
];

const TAB_HINT: Record<FlowTab, string> = {
  receitas: "Tudo o que entrou no período.",
  despesas: "Tudo o que saiu no período.",
  caixa: "O que sobrou (entrou menos saiu) em cada mês.",
  projecao: "O que ainda é esperado: agendados, pendentes e as despesas fixas que se repetem.",
};

export default function Flow() {
  const [params] = useSearchParams();
  const initialTab = (params.get("metric") ?? "caixa") as FlowTab;
  const { hidden } = useBalanceHidden();

  const [month, setMonth] = useState(params.get("month") ?? currentMonth());
  const [tab, setTab] = useState<FlowTab>(TABS.some((t) => t.key === initialTab) ? initialTab : "caixa");
  const [period, setPeriod] = useState<FlowPeriod>("12");
  const [fromMonth, setFromMonth] = useState(addMonth(currentMonth(), -5));
  const [toMonth, setToMonth] = useState(currentMonth());
  const [categoryId, setCategoryId] = useState("todas");

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 60_000 });
  const categories = categoriesQuery.data ?? [];

  const flowParams = useMemo(() => {
    const base: Record<string, string | number> = { month };
    if (period === "custom") {
      base.from_month = fromMonth;
      base.to_month = toMonth;
    } else {
      base.months = Number(period);
    }
    if (categoryId !== "todas") base.category_id = categoryId;
    return base;
  }, [month, period, fromMonth, toMonth, categoryId]);

  const flowQuery = useQuery({
    queryKey: ["flow", flowParams],
    queryFn: () => fetchFlow(flowParams),
  });
  const flow = flowQuery.data;
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  const chartData =
    flow?.series.map((point) => ({
      label: point.label,
      year: point.year,
      value:
        tab === "receitas"
          ? point.income
          : tab === "despesas"
            ? point.expense
            : tab === "caixa"
              ? point.net
              : point.projected_net,
      future: point.future,
    })) ?? [];

  const barColor = (value: number) =>
    tab === "receitas"
      ? "var(--income)"
      : tab === "despesas"
        ? "var(--expense)"
        : value >= 0
          ? "var(--income)"
          : "var(--expense)";

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="flow-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Fluxo</h1>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="flow-subtitle">
            Entradas, saídas e projeção · {monthLabel(month)}
          </p>
        </div>
        <MonthSelector month={month} onChange={(next) => setMonth(next)} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Período do fluxo">
          {PERIODS.map((item) => (
            <Button
              key={item.key}
              size="sm"
              variant={period === item.key ? "default" : "outline"}
              onClick={() => setPeriod(item.key)}
              data-testid={`flow-period-${item.key}`}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger size="sm" className="w-52" aria-label="Filtrar fluxo por categoria" data-testid="flow-category-select">
            <SelectValue>
              {categoryId === "todas" ? "Todas as categorias" : categories.find((c) => c.id === categoryId)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as categorias</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {period === "custom" ? (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4" data-testid="flow-custom-range">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="flow-from" className="text-xs font-medium text-muted-foreground">
              De
            </label>
            <Input
              id="flow-from"
              type="month"
              value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value || currentMonth())}
              className="w-44"
              data-testid="flow-from-input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="flow-to" className="text-xs font-medium text-muted-foreground">
              Até
            </label>
            <Input
              id="flow-to"
              type="month"
              value={toMonth}
              onChange={(e) => setToMonth(e.target.value || currentMonth())}
              className="w-44"
              data-testid="flow-to-input"
            />
          </div>
        </div>
      ) : null}

      {flowQuery.isPending ? (
        <FinnosPageLoading title="Carregando fluxo" description="Montando a entrada, saída e sobra do período." />
      ) : flowQuery.error || !flow ? (
        <Card>
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground" data-testid="flow-error-message">
              Não foi possível carregar o fluxo. Tente novamente.
            </p>
            <Button variant="outline" onClick={() => flowQuery.refetch()} data-testid="flow-retry-button">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="py-0">
            <CardContent className="p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sobrou</p>
              <p
                className={cn(
                  "mt-1 font-heading text-4xl font-bold tabular-nums",
                  flow.net >= 0 ? "text-income" : "text-expense",
                )}
                data-testid="flow-net-value"
              >
                {money(flow.net)}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Entrou</p>
                  <p className="mt-1 font-heading text-xl font-bold tabular-nums text-income" data-testid="flow-income-value">
                    {money(flow.income)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Saiu</p>
                  <p className="mt-1 font-heading text-xl font-bold tabular-nums text-expense" data-testid="flow-expense-value">
                    {money(flow.expense)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Ainda previsto</p>
                  <p className="mt-1 font-heading text-xl font-bold tabular-nums text-foreground" data-testid="flow-projected-value">
                    {money(flow.projected_net)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Caixa do período</p>
                  <p className="mt-1 font-heading text-xl font-bold tabular-nums text-foreground" data-testid="flow-total-net-value">
                    {money(flow.total_net)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Fluxo de caixa · {monthLabel(flow.from_month)} a {monthLabel(flow.to_month)}
            </h2>
            <div className="mt-3 h-64 w-full rounded-2xl border border-border bg-card p-4" data-testid="flow-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      color: "var(--popover-foreground)",
                      fontSize: 13,
                    }}
                    formatter={(value: number) => [formatBRL(value), TABS.find((t) => t.key === tab)?.label ?? ""]}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={34}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`${entry.label}-${index}`}
                        fill={barColor(entry.value)}
                        fillOpacity={entry.future && tab !== "projecao" ? 0.45 : 1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div>
            <div
              className="flex gap-1 rounded-full border border-border bg-muted/60 p-1"
              role="tablist"
              aria-label="Tipo de fluxo"
            >
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors duration-150",
                    tab === item.key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`flow-tab-${item.key}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="flow-tab-hint">
              {TAB_HINT[tab]}
            </p>
          </div>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Onde foi o dinheiro · {monthLabel(flow.month)}
            </h2>
            {flow.categories.length === 0 ? (
              <p
                className="mt-3 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
                data-testid="flow-categories-empty"
              >
                Nenhum gasto categorizado neste mês.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5" data-testid="flow-category-list">
                {flow.categories.map((slice) => (
                  <li key={slice.category_id ?? slice.name} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${slice.color}1A`, color: slice.color }}
                      aria-hidden="true"
                    >
                      <CategoryIcon name={slice.icon} className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{slice.name}</p>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{money(slice.total)}</p>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
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
        </>
      )}
    </div>
  );
}
