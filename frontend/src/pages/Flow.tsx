import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ArrowLeft, ChartColumn, ChartLine, ChevronRight, Eye, EyeOff } from "lucide-react";
import { fetchCategories, fetchFlow } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { addMonth, currentMonth, formatBRL, formatHiddenBRL, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MonthSelector } from "@/components/dashboard/MonthSelector";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { Button, buttonVariants } from "@/components/ui/button";
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
  receitas: "Tudo o que entrou em cada mês.",
  despesas: "Tudo o que saiu em cada mês.",
  caixa: "O que sobrou (entrou menos saiu) em cada mês.",
  projecao: "O que ainda é esperado: agendados, pendentes e as despesas fixas que se repetem.",
};

type ChartKind = "barras" | "linhas";

export default function Flow() {
  const [params] = useSearchParams();
  const initialTab = (params.get("metric") ?? "caixa") as FlowTab;
  const { hidden, toggle: toggleHidden } = useBalanceHidden();

  const [month, setMonth] = useState(params.get("month") ?? currentMonth());
  const [tab, setTab] = useState<FlowTab>(TABS.some((t) => t.key === initialTab) ? initialTab : "caixa");
  const [period, setPeriod] = useState<FlowPeriod>("12");
  const [chartKind, setChartKind] = useState<ChartKind>("barras");
  const [fromMonth, setFromMonth] = useState(addMonth(currentMonth(), -5));
  const [toMonth, setToMonth] = useState(currentMonth());
  const [categoryId, setCategoryId] = useState(params.get("category_id") || "todas");

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
      month: point.month,
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

  const tone = tab === "receitas" ? "var(--income)" : tab === "despesas" ? "var(--expense)" : "var(--primary)";
  const barColor = (value: number) =>
    tab === "receitas"
      ? "var(--income)"
      : tab === "despesas"
        ? "var(--expense)"
        : value >= 0
          ? "var(--income)"
          : "var(--expense)";
  // Clicking a month on the chart focuses the summary and categories on it.
  const focusMonth = (target?: string) => {
    if (target && /^\d{4}-\d{2}$/.test(target)) setMonth(target);
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-up" data-testid="flow-page">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {/* Cash flow is a detail of Fluxo, reached from its Entrada / Saída / Saldo. */}
          <Link
            to={`/transacoes?month=${month}`}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "mt-0.5 size-10 shrink-0 rounded-full border border-border bg-card")}
            aria-label="Voltar para o Fluxo"
            title="Voltar para o Fluxo"
            data-testid="flow-breadcrumb-back"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Fluxo de caixa</h1>
            <p data-keep className="mt-1 text-sm text-muted-foreground" data-testid="flow-subtitle">
              {monthLabel(month)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleHidden}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/75 transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
            aria-pressed={hidden}
            title={hidden ? "Mostrar valores" : "Ocultar valores"}
          >
            {hidden ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
          </button>
          <MonthSelector month={month} onChange={(next) => setMonth(next)} />
        </div>
      </header>

      <div>
        <div className="flex gap-1 rounded-full border border-border bg-muted/60 p-1" role="tablist" aria-label="Tipo de fluxo">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                "flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors duration-150",
                tab === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`flow-tab-${item.key}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-2 hidden text-xs text-muted-foreground sm:block" data-testid="flow-tab-hint">{TAB_HINT[tab]}</p>
      </div>

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
          {/* The month's numbers, in the same card style as Fluxo. Each one selects its tab. */}
          <section className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-card p-2 sm:grid-cols-4" aria-label={`Resumo de ${monthLabel(flow.month)}`}>
            {([
              { key: "receitas", label: "Entrou", value: flow.income, className: "text-income", testid: "flow-income-value" },
              { key: "despesas", label: "Saiu", value: flow.expense, className: "text-expense", testid: "flow-expense-value" },
              { key: "caixa", label: flow.net >= 0 ? "Sobrou" : "Faltou", value: Math.abs(flow.net), className: flow.net >= 0 ? "text-income" : "text-expense", testid: "flow-net-value" },
              { key: "projecao", label: "Ainda vai entrar/sair", value: flow.projected_net, className: "text-foreground", testid: "flow-projected-value" },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-pressed={tab === item.key}
                className={cn(
                  "min-w-0 rounded-xl px-3 py-3 text-left transition-colors",
                  tab === item.key ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                {/* The label already says Sobrou/Faltou; never show "Faltou −R$". */}
                <p className={cn("mt-1 break-words font-heading text-lg font-bold tabular-nums", item.className)} data-testid={item.testid}>
                  {money(item.value)}
                </p>
              </button>
            ))}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Evolução por mês">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-heading text-base font-semibold text-foreground">
                  {TABS.find((t) => t.key === tab)?.label} por mês
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {monthLabel(flow.from_month)} a {monthLabel(flow.to_month)} · acumulado{" "}
                  <span className="font-semibold tabular-nums text-foreground" data-testid="flow-total-net-value">{money(flow.total_net)}</span>
                </p>
              </div>
              <div className="flex gap-1 rounded-full border border-border bg-muted/60 p-1" role="group" aria-label="Tipo de gráfico">
                {([
                  { key: "barras" as const, label: "Barras", icon: ChartColumn },
                  { key: "linhas" as const, label: "Linhas", icon: ChartLine },
                ]).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setChartKind(item.key)}
                    aria-pressed={chartKind === item.key}
                    aria-label={`Gráfico de ${item.label.toLowerCase()}`}
                    title={item.label}
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                      chartKind === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    data-testid={`flow-chart-${item.key}`}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1" role="group" aria-label="Período do fluxo">
                {PERIODS.map((item) => (
                  <Button
                    key={item.key}
                    size="sm"
                    variant={period === item.key ? "secondary" : "ghost"}
                    className="h-8 shrink-0 rounded-full px-3"
                    onClick={() => setPeriod(item.key)}
                    aria-pressed={period === item.key}
                    data-testid={`flow-period-${item.key}`}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Filtrar fluxo por categoria" data-testid="flow-category-select">
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
              <div className="mt-3 flex flex-wrap items-end gap-3" data-testid="flow-custom-range">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="flow-from" className="text-xs font-medium text-muted-foreground">De</label>
                  <Input id="flow-from" type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value || currentMonth())} className="w-44" data-testid="flow-from-input" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="flow-to" className="text-xs font-medium text-muted-foreground">Até</label>
                  <Input id="flow-to" type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value || currentMonth())} className="w-44" data-testid="flow-to-input" />
                </div>
              </div>
            ) : null}

            <div className="mt-4 h-60 w-full" data-testid="flow-chart">
              <ResponsiveContainer width="100%" height="100%">
                {chartKind === "barras" ? (
                  <BarChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} onClick={(state) => focusMonth(chartData[Number(state?.activeTooltipIndex)]?.month)}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={tooltipStyle} formatter={(value: number) => [hidden ? formatHiddenBRL() : formatBRL(value), TABS.find((t) => t.key === tab)?.label ?? ""]} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={30} className="cursor-pointer">
                      {chartData.map((entry, index) => (
                        <Cell
                          key={`${entry.label}-${index}`}
                          fill={barColor(entry.value)}
                          fillOpacity={entry.month === flow.month ? 1 : entry.future && tab !== "projecao" ? 0.3 : 0.55}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <AreaChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} onClick={(state) => focusMonth(chartData[Number(state?.activeTooltipIndex)]?.month)}>
                    <defs>
                      <linearGradient id="flow-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={tone} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={tone} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [hidden ? formatHiddenBRL() : formatBRL(value), TABS.find((t) => t.key === tab)?.label ?? ""]} />
                    <Area type="monotone" dataKey="value" stroke={tone} strokeWidth={2} fill="url(#flow-area)" dot={false} activeDot={{ r: 4 }} />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
            <p className="mt-2 hidden text-xs text-muted-foreground sm:block">Toque em um mês para ver o resumo dele.</p>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-heading text-base font-semibold text-foreground">Onde foi o dinheiro</h2>
              <span className="text-xs text-muted-foreground">{monthLabel(flow.month)}</span>
            </div>
            {flow.categories.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground" data-testid="flow-categories-empty">
                Nenhum gasto categorizado neste mês.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border/70" data-testid="flow-category-list">
                {flow.categories.map((slice) => (
                  <li key={slice.category_id ?? slice.name}>
                    {/* Opens Fluxo filtered by this category and month. */}
                    <Link
                      to={`/transacoes?month=${flow.month}&metric=despesas${slice.category_id ? `&category_id=${encodeURIComponent(slice.category_id)}` : ""}`}
                      className="group flex items-center gap-3 rounded-xl px-1 py-3 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${slice.color}1A`, color: slice.color }} aria-hidden="true">
                        <CategoryIcon name={slice.icon} className="h-4.5 w-4.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-foreground">{slice.name}</p>
                          <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{money(slice.total)}</p>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(slice.percent, 100)}%`, backgroundColor: slice.color }} />
                        </div>
                      </div>
                      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{Math.round(slice.percent)}%</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
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

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
  fontSize: 13,
};
