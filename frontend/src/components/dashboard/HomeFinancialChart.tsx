import { ChartReveal, SeriesChip, finnosAnimation, finnosAxisTick, finnosBar, finnosEstimate, finnosGrid, finnosReal, finnosTooltip } from "@/components/charts/rechartsFinnos";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart as RechartsLineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowDownLeft, ArrowUpRight, Equal } from "lucide-react";
import { fetchBalanceHistory, fetchCalendar, fetchTrends } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { buildMonthlyCumulativeRows, defaultDailyTooltipIndex, selectVisibleDailyRows } from "@/lib/homeChart";
import { isThisMonth, pinIndex } from "@/lib/chartPin";
import { buildProjectionRows, PROJECTION_KEYS, type ProjectionKey } from "@/lib/homeProjection";
import { pickMany, useChartPreference } from "@/lib/chartPreferences";
import type { MetricKind } from "@/types/finnos";
import type { FinnosView, FinnosSeries } from "@/components/shared/FinnosVerticalMenu";

type ChartView = "cards" | "projection" | "line" | "pie" | "bars";
type ChartPeriod = "7d" | "1m" | "3m" | "6m" | "1y";
const VIEW_TO_CHART: Record<FinnosView, ChartView> = { Cards:"cards", "Projeção":"projection", Linhas:"line", Pizza:"pie", Barras:"bars" };
const PERIOD_TO_CHART: Record<string, ChartPeriod> = { "7 dias":"7d", "1 mês":"1m", "3 meses":"3m", "6 meses":"6m", "1 ano":"1y" };

interface HomeFinancialChartProps {
  month: string;
  total: number;
  income: number;
  expense: number;
  result: number;
  onOpenMetric: (metric: MetricKind) => void;
  menuView: FinnosView;
  menuInterval: string;
  menuSeries: FinnosSeries[];
  /** Inside a card that already has its own title (desktop Home). */
  bare?: boolean;
}

const METRIC_UI = {
  Receitas: { icon: ArrowDownLeft, color: "var(--income)", soft: "bg-income/10 text-income" },
  Despesas: { icon: ArrowUpRight, color: "var(--expense)", soft: "bg-expense/10 text-expense" },
  Resultado: { icon: Equal, color: "var(--finnos-purple)", soft: "bg-primary/10 text-primary" },
} as const;

const PROJECTION_UI: Record<ProjectionKey, { label: string; color: string }> = {
  balance: { label: "Saldo", color: "var(--finnos-purple)" },
  income: { label: "Receitas", color: "var(--income)" },
  expense: { label: "Despesas", color: "var(--expense)" },
};

function addMonth(value: string, direction: -1 | 1): string {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + direction, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function HomeFinancialChart({ month, total, onOpenMetric, menuView, menuInterval, menuSeries, bare = false }: HomeFinancialChartProps) {
  const { hidden } = useBalanceHidden();
  const view = VIEW_TO_CHART[menuView];
  const period = PERIOD_TO_CHART[menuInterval] ?? "1m";
  const showIncome = menuSeries.includes("Receitas");
  const showExpense = menuSeries.includes("Despesas");
  const showResult = menuSeries.includes("Resultado");
  // Several series can be on at once; none selected means all of them.
  // Kept with the chart preferences, so the series stay as the person left them.
  const [selectedMetrics, setSelectedMetricsValue] = useChartPreference<Array<"Receitas" | "Despesas" | "Resultado">>(
    "metrics", (v) => pickMany(v, ["Receitas", "Despesas", "Resultado"] as const, [], true));
  const selectedMetric = selectedMetrics.length === 1 ? selectedMetrics[0] : null;
  const [projectionSeries, setProjectionSeriesValue] = useChartPreference<ProjectionKey[]>(
    "projection", (v) => pickMany(v, PROJECTION_KEYS, ["balance"]));
  const [projectionMonth, setProjectionMonth] = useState(month);
  const [projectionDragX, setProjectionDragX] = useState<number | null>(null);
  const chartScrollerRef = useRef<HTMLDivElement | null>(null);

  const daily = period === "7d" || period === "1m";
  const calendarQuery = useQuery({
    // Under "calendar": refreshed with every new or edited lançamento, like the other screens.
    queryKey: ["calendar", "home", view === "projection" ? projectionMonth : month],
    queryFn: () => fetchCalendar(view === "projection" ? projectionMonth : month),
    enabled: daily,
  });
  const trendsQuery = useQuery({
    queryKey: ["trends", "home", period, month],
    queryFn: () => fetchTrends(period === "1y" ? 12 : period === "3m" ? 3 : 6, month),
    enabled: !daily,
  });

  // The real money in the accounts day by day (same rule as Saldo total), for the Saldo line.
  const historyQuery = useQuery({
    queryKey: ["dashboard", "balance-history", projectionMonth],
    queryFn: () => fetchBalanceHistory(projectionMonth),
    enabled: view === "projection",
  });

  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  const chartData = useMemo(() => {
    if (!daily) {
      return (trendsQuery.data?.months ?? []).map((item) => ({
        label: item.label,
        Receitas: item.income,
        Despesas: item.expense,
        Resultado: item.net,
      }));
    }

    const rows = buildMonthlyCumulativeRows(month, calendarQuery.data?.days ?? [], todayISO());
    return selectVisibleDailyRows(rows, month, period, todayISO());
  }, [calendarQuery.data, daily, month, period, trendsQuery.data]);

  const defaultTooltipIndex = useMemo(
    () => daily ? defaultDailyTooltipIndex(chartData, month, todayISO()) : pinIndex(trendsQuery.data?.months ?? [], (m) => isThisMonth(m)),
    [chartData, daily, month, trendsQuery.data],
  );

  const projectionData = useMemo(
    () => buildProjectionRows({
      month: projectionMonth,
      days: calendarQuery.data?.days ?? [],
      // An older server without the history falls back to today's total.
      history: historyQuery.isError ? undefined : historyQuery.data,
      total,
      today: todayISO(),
    }),
    [calendarQuery.data?.days, historyQuery.data, historyQuery.isError, projectionMonth, total],
  );

  useEffect(() => {
    if (view !== "bars" || !daily || !chartScrollerRef.current) return;
    const today = todayISO();
    if (today.slice(0, 7) !== month) return;
    const day = Number(today.slice(8, 10));
    const ratio = Math.max(0, Math.min(1, (day - 1) / Math.max(chartData.length - 1, 1)));
    const node = chartScrollerRef.current;
    window.requestAnimationFrame(() => {
      node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) * ratio - node.clientWidth * 0.35);
    });
  }, [chartData.length, daily, month, view]);

  const periodSummary = useMemo(() => {
    if (chartData.length === 0) return { income: 0, expense: 0, result: 0 };
    const last = chartData[chartData.length - 1];
    if (daily) return { income: last.Receitas, expense: last.Despesas, result: last.Resultado };
    return chartData.reduce((acc, item) => ({
      income: acc.income + item.Receitas,
      expense: acc.expense + item.Despesas,
      result: acc.result + item.Resultado,
    }), { income: 0, expense: 0, result: 0 });
  }, [chartData, daily]);

  const pieData = [
    { name: "Receitas", value: Math.max(periodSummary.income, 0), fill: METRIC_UI.Receitas.color, metric: "income" as MetricKind },
    { name: "Despesas", value: Math.max(periodSummary.expense, 0), fill: METRIC_UI.Despesas.color, metric: "expense" as MetricKind },
  ].filter((item) => item.value > 0);
  const selectedPieItem = selectedMetric ? pieData.find((item) => item.name === selectedMetric) ?? null : null;
  const metricVisible = (name: "Receitas" | "Despesas" | "Resultado") => selectedMetrics.length === 0 || selectedMetrics.includes(name);
  const toggleMetric = (name: "Receitas" | "Despesas" | "Resultado") => setSelectedMetricsValue(selectedMetrics.includes(name) ? selectedMetrics.filter((x) => x !== name) : [...selectedMetrics, name]);

  const tooltipStyle = finnosTooltip.contentStyle;
  const isLoading = daily ? calendarQuery.isPending || (view === "projection" && historyQuery.isPending) : trendsQuery.isPending;
  const periodLabel = menuInterval;

  const projectionColor = PROJECTION_UI[projectionSeries[0] ?? "balance"].color;
  const toggleProjection = (key: ProjectionKey) => setProjectionSeriesValue(projectionSeries.includes(key) ? (projectionSeries.length > 1 ? projectionSeries.filter((x) => x !== key) : projectionSeries) : [...projectionSeries, key]);
  // The tooltip starts on today (the last day of a past month, the first of a future one).
  const todayLabel = projectionMonth === todayISO().slice(0, 7) ? todayISO().slice(8, 10) : projectionMonth < todayISO().slice(0, 7) ? String(projectionData.at(-1)?.label) : "01";
  const projectionTooltipIndex = pinIndex(projectionData, (row) => row.label === todayLabel);
  // One line per selected series: the real value up to today, the estimate after it.
  const projectionTooltip = ({ label }: { label?: string | number }) => {
    const row = projectionData.find((item) => item.label === label);
    if (!row) return null;
    return (
      <div style={tooltipStyle} className="px-3 py-2" data-testid="home-chart-tooltip">
        <p className="text-xs font-medium text-muted-foreground">Dia {row.label}{row.estimate ? " · estimativa" : ""}</p>
        {projectionSeries.map((key) => {
          const value = (row[`${key}Actual`] ?? row[`${key}Forecast`]) as number | null;
          return <p key={key} className="mt-1 flex items-center gap-1.5 text-sm"><span className="size-2 rounded-full" style={{ backgroundColor: PROJECTION_UI[key].color }} aria-hidden="true" /><span className="text-muted-foreground">{PROJECTION_UI[key].label}</span><strong className="ml-auto pl-3 tabular-nums">{value === null || value === undefined ? "—" : money(value)}</strong></p>;
        })}
      </div>
    );
  };
  const shiftProjectionMonth = (direction: -1 | 1) => setProjectionMonth((current) => addMonth(current, direction));

  return (
    <div className={bare ? "" : "border-t border-border/70 pt-5"} data-testid="home-financial-chart">
      <div className={cn("mb-4 flex items-center justify-between gap-3", bare && "sr-only")}>
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">Saldo ao longo do tempo</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {view === "cards" ? "Resumo financeiro" : view === "pie" ? "Composição do período" : view === "projection" ? "Saldo real até hoje e estimativa até o fim do mês" : `Evolução · ${periodLabel}`}
          </p>
        </div>

      </div>

      {view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { name: "Receitas", value: periodSummary.income, icon: ArrowDownLeft, tone: "text-income bg-income/10" },
            { name: "Despesas", value: periodSummary.expense, icon: ArrowUpRight, tone: "text-expense bg-expense/10" },
            { name: "Resultado", value: periodSummary.result, icon: Equal, tone: "text-primary bg-primary/10" },
          ].map((item) => (
            <button key={item.name} type="button" onClick={() => onOpenMetric(item.name === "Receitas" ? "income" : item.name === "Despesas" ? "expense" : "balance")} className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/70 bg-card/70 p-4 text-left shadow-sm transition hover:bg-muted/40">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.tone}`}><item.icon className="h-5 w-5" /></span>
              <span className="min-w-0"><span className="block text-xs font-medium text-muted-foreground">{item.name}</span><strong className="mt-1 block truncate font-heading text-lg tabular-nums text-foreground">{money(item.value)}</strong></span>
            </button>
          ))}
        </div>
      ) : isLoading ? (
        <div className="h-[270px] animate-pulse rounded-2xl bg-muted/50" />
      ) : view === "projection" ? (
        <div
          className="w-full touch-pan-y pb-1"
          onTouchStart={(event) => setProjectionDragX(event.touches[0]?.clientX ?? null)}
          onTouchEnd={(event) => {
            if (projectionDragX === null) return;
            const endX = event.changedTouches[0]?.clientX ?? projectionDragX;
            const delta = endX - projectionDragX;
            if (Math.abs(delta) >= 55) shiftProjectionMonth(delta < 0 ? 1 : -1);
            setProjectionDragX(null);
          }}
          data-testid="home-projection-chart"
        >
          <div className="mb-1 flex items-center justify-between">
            <button type="button" onClick={() => shiftProjectionMonth(-1)} className="rounded-full px-2 py-1 text-lg text-muted-foreground" aria-label="Mês anterior">‹</button>
            <span className="text-xs font-medium text-muted-foreground">{monthLabel(projectionMonth)}</span>
            <button type="button" onClick={() => shiftProjectionMonth(1)} className="rounded-full px-2 py-1 text-lg text-muted-foreground" aria-label="Próximo mês">›</button>
          </div>
          <ChartReveal className="h-[280px] w-full sm:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLineChart data={projectionData} margin={{ top: 16, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="finnosForecastSmoke" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={projectionColor} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={projectionColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...finnosGrid} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={42} tick={finnosAxisTick} />
                <YAxis tickLine={false} axisLine={false} width={62} tick={finnosAxisTick} tickFormatter={(v) => hidden ? "•••" : `R$ ${Math.round(Number(v) / 1000)}k`} />
                <Tooltip active defaultIndex={projectionTooltipIndex} content={projectionTooltip} cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.5 }} />
                {projectionSeries.length === 1 ? <Area type="monotone" dataKey={`${projectionSeries[0]}Actual`} stroke="none" fill="url(#finnosForecastSmoke)" connectNulls={false} tooltipType="none" activeDot={false} {...finnosAnimation} /> : null}
                {projectionSeries.flatMap((key) => [
                  <Line key={`${key}a`} type="monotone" dataKey={`${key}Actual`} {...finnosReal(PROJECTION_UI[key].color)} connectNulls={false} {...finnosAnimation} />,
                  <Line key={`${key}f`} type="monotone" dataKey={`${key}Forecast`} {...finnosEstimate(PROJECTION_UI[key].color)} connectNulls={false} {...finnosAnimation} animationBegin={500} />,
                ])}
              </RechartsLineChart>
            </ResponsiveContainer>
          </ChartReveal>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
            {PROJECTION_KEYS.map((key) => (
              <SeriesChip key={key} on={projectionSeries.includes(key)} color={PROJECTION_UI[key].color} label={PROJECTION_UI[key].label} onClick={() => toggleProjection(key)} testId={`home-chart-series-${key}`} />
            ))}
            <span className="flex items-center gap-1.5 px-1.5 py-1.5 text-muted-foreground"><span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: projectionColor }} />Estimativa</span>
          </div>
          <p className="mt-2 hidden text-center text-xs text-muted-foreground sm:block">Arraste para os lados para mudar de mês.</p>
        </div>
      ) : view === "pie" ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-1 sm:min-h-[270px] sm:flex-row sm:gap-10 sm:py-2">
          <div className="relative h-44 w-44 shrink-0 sm:h-48 sm:w-48" onClick={(event) => { if (event.target === event.currentTarget) setSelectedMetricsValue([]); }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => money(value)} />
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="98%" paddingAngle={2} cornerRadius={6} strokeWidth={0} onClick={(_, index) => { const item = pieData[index]; if (item) toggleMetric(item.name as "Receitas" | "Despesas"); }}>
                  {pieData.map((entry) => <Cell key={entry.name} fill={entry.fill} opacity={selectedMetric && selectedMetric !== entry.name ? 0.18 : 1} className="cursor-pointer" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-muted-foreground">{selectedPieItem?.name ?? "Resultado"}</span>
              <strong className="mt-1 max-w-[8rem] truncate font-heading text-lg font-bold tabular-nums text-foreground">{money(selectedPieItem?.value ?? periodSummary.result)}</strong>
            </div>
          </div>
          <div className="w-full max-w-sm space-y-2">
            {pieData.map((entry) => {
              const metricName = entry.name as "Receitas" | "Despesas" | "Resultado";
              const Icon = METRIC_UI[metricName].icon;
              const active = !selectedMetric || selectedMetric === metricName;
              return (
                <button type="button" key={entry.name} onClick={() => toggleMetric(metricName)} className={`grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-all hover:bg-muted/40 ${active ? "opacity-100" : "opacity-40"}`}>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${METRIC_UI[metricName].soft}`}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{entry.name}</span>
                  <strong className="whitespace-nowrap text-right font-heading text-sm tabular-nums text-foreground">{money(entry.value)}</strong>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div ref={chartScrollerRef} className="w-full overflow-x-auto pb-1 [scrollbar-width:none]">
          <ChartReveal className={`h-[280px] sm:h-[310px] ${view === "bars" && daily ? "min-w-[720px]" : "min-w-0 w-full"}`}>
          <ResponsiveContainer width="100%" height="100%">
            {view === "bars" ? (
              <BarChart data={chartData} margin={{ top: 12, right: 8, left: -8, bottom: 0 }} barGap={3}>
                <CartesianGrid {...finnosGrid} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={daily ? 18 : 8} tick={finnosAxisTick} />
                <YAxis tickLine={false} axisLine={false} width={62} tick={finnosAxisTick} tickFormatter={(v) => hidden ? "•••" : `R$ ${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  active
                  defaultIndex={defaultTooltipIndex}
                  cursor={{ fill: "var(--muted)", opacity: 0.25 }}
                  {...finnosTooltip}
                  formatter={(value: number) => money(value)}
                  labelFormatter={(label) => daily ? `Dia ${label}` : String(label)}
                />
                {showIncome && metricVisible("Receitas") && <Bar dataKey="Receitas" onClick={() => toggleMetric("Receitas")} className="cursor-pointer" fill={METRIC_UI.Receitas.color} {...finnosBar} {...finnosAnimation} />}
                {showExpense && metricVisible("Despesas") && <Bar dataKey="Despesas" onClick={() => toggleMetric("Despesas")} className="cursor-pointer" fill={METRIC_UI.Despesas.color} {...finnosBar} {...finnosAnimation} />}
                {showResult && metricVisible("Resultado") && <Bar dataKey="Resultado" onClick={() => toggleMetric("Resultado")} className="cursor-pointer" fill={METRIC_UI.Resultado.color} {...finnosBar} {...finnosAnimation} />}
              </BarChart>
            ) : (
              <AreaChart data={chartData} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="finnosResultFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...finnosGrid} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={daily ? 18 : 8} tick={finnosAxisTick} />
                <YAxis tickLine={false} axisLine={false} width={62} tick={finnosAxisTick} tickFormatter={(v) => hidden ? "•••" : `R$ ${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  active
                  defaultIndex={defaultTooltipIndex}
                  {...finnosTooltip}
                  formatter={(value: number) => money(value)}
                  labelFormatter={(label) => daily ? `Dia ${label}` : String(label)}
                />
                {showResult && metricVisible("Resultado") && <Area type="monotone" dataKey="Resultado" onClick={() => toggleMetric("Resultado")} className="cursor-pointer" {...finnosReal(METRIC_UI.Resultado.color)} fill="url(#finnosResultFill)" {...finnosAnimation} />}
                {showIncome && metricVisible("Receitas") && <Area type="monotone" dataKey="Receitas" onClick={() => toggleMetric("Receitas")} className="cursor-pointer" {...finnosReal(METRIC_UI.Receitas.color)} fill="transparent" {...finnosAnimation} />}
                {showExpense && metricVisible("Despesas") && <Area type="monotone" dataKey="Despesas" onClick={() => toggleMetric("Despesas")} className="cursor-pointer" {...finnosReal(METRIC_UI.Despesas.color)} fill="transparent" {...finnosAnimation} />}
              </AreaChart>
            )}
          </ResponsiveContainer>
          </ChartReveal>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs" role="group" aria-label="Filtrar série do gráfico">
            <button
              type="button"
              onClick={() => setSelectedMetricsValue([])}
              className={`rounded-full border px-3 py-1.5 font-medium transition-colors ${selectedMetrics.length === 0 ? "border-border bg-muted text-foreground" : "border-border/60 text-muted-foreground"}`}
            >
              Todos
            </button>
            {showExpense && <SeriesChip on={selectedMetrics.includes("Despesas")} color={METRIC_UI.Despesas.color} label="Despesas" onClick={() => toggleMetric("Despesas")} />}
            {showIncome && <SeriesChip on={selectedMetrics.includes("Receitas")} color={METRIC_UI.Receitas.color} label="Receitas" onClick={() => toggleMetric("Receitas")} />}
            {showResult && <SeriesChip on={selectedMetrics.includes("Resultado")} color={METRIC_UI.Resultado.color} label="Resultado" onClick={() => toggleMetric("Resultado")} />}
          </div>
        </div>
      )}

    </div>
  );
}
