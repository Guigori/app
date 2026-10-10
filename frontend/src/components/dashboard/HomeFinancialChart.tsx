import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart as RechartsLineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowDownLeft, ArrowUpRight, Equal } from "lucide-react";
import { fetchCalendar, fetchTrends } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { buildMonthlyCumulativeRows, defaultDailyTooltipIndex, selectVisibleDailyRows } from "@/lib/homeChart";
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
}

const METRIC_UI = {
  Receitas: { icon: ArrowDownLeft, color: "var(--income)", soft: "bg-emerald-500/10 text-emerald-400" },
  Despesas: { icon: ArrowUpRight, color: "var(--expense)", soft: "bg-rose-500/10 text-rose-400" },
  Resultado: { icon: Equal, color: "var(--finnos-purple)", soft: "bg-violet-500/10 text-violet-400" },
} as const;

function addMonth(value: string, direction: -1 | 1): string {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + direction, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function HomeFinancialChart({ month, total, income, expense, result, onOpenMetric, menuView, menuInterval, menuSeries }: HomeFinancialChartProps) {
  const { hidden } = useBalanceHidden();
  const view = VIEW_TO_CHART[menuView];
  const period = PERIOD_TO_CHART[menuInterval] ?? "1m";
  const showIncome = menuSeries.includes("Receitas");
  const showExpense = menuSeries.includes("Despesas");
  const showResult = menuSeries.includes("Resultado");
  const [selectedMetric, setSelectedMetric] = useState<"Receitas" | "Despesas" | "Resultado" | null>(null);
  const [projectionMetric, setProjectionMetric] = useState<"balance" | "income" | "expense">("balance");
  const [projectionMonth, setProjectionMonth] = useState(month);
  const [projectionDragX, setProjectionDragX] = useState<number | null>(null);
  const chartScrollerRef = useRef<HTMLDivElement | null>(null);

  const daily = period === "7d" || period === "1m";
  const calendarQuery = useQuery({
    queryKey: ["home-financial-calendar", view === "projection" ? projectionMonth : month],
    queryFn: () => fetchCalendar(view === "projection" ? projectionMonth : month),
    enabled: daily,
  });
  const trendsQuery = useQuery({
    queryKey: ["home-financial-trends", period, month],
    queryFn: () => fetchTrends(period === "1y" ? 12 : period === "3m" ? 3 : 6, month),
    enabled: !daily,
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
    () => daily ? defaultDailyTooltipIndex(chartData, month, todayISO()) : undefined,
    [chartData, daily, month],
  );

  const projectionData = useMemo(() => {
    const days = calendarQuery.data?.days ?? [];
    const activeMonth = projectionMonth;
    const [year, monthNumber] = activeMonth.split("-").map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const today = todayISO();
    const currentMonth = today.slice(0, 7);
    const cutoffDay = activeMonth === currentMonth ? Math.min(Number(today.slice(8, 10)), daysInMonth) : activeMonth < currentMonth ? daysInMonth : 0;
    const byDate = new Map(days.map((day) => [day.date, day]));
    let realisedIncome = 0;
    let realisedExpense = 0;
    for (let n = 1; n <= cutoffDay; n += 1) {
      const day = byDate.get(`${activeMonth}-${String(n).padStart(2, "0")}`);
      realisedIncome += day?.income ?? 0;
      realisedExpense += day?.expense ?? 0;
    }
    const openingBalance = total - (realisedIncome - realisedExpense);
    let actualIncome = 0;
    let actualExpense = 0;
    let forecastIncome = realisedIncome;
    let forecastExpense = realisedExpense;
    return Array.from({ length: daysInMonth }, (_, index) => {
      const n = index + 1;
      const day = byDate.get(`${activeMonth}-${String(n).padStart(2, "0")}`);
      if (n <= cutoffDay) {
        actualIncome += day?.income ?? 0;
        actualExpense += day?.expense ?? 0;
      }
      if (n > cutoffDay) {
        forecastIncome += day?.projected_income ?? 0;
        forecastExpense += day?.projected_expense ?? 0;
      }
      const actualValue = projectionMetric === "income" ? actualIncome : projectionMetric === "expense" ? actualExpense : openingBalance + actualIncome - actualExpense;
      const forecastValue = projectionMetric === "income" ? forecastIncome : projectionMetric === "expense" ? forecastExpense : total + (forecastIncome - realisedIncome) - (forecastExpense - realisedExpense);
      return {
        label: String(n).padStart(2, "0"),
        actual: n <= cutoffDay ? Math.round(actualValue * 100) / 100 : null,
        forecast: n >= cutoffDay && cutoffDay > 0 ? Math.round((n === cutoffDay ? actualValue : forecastValue) * 100) / 100 : null,
      };
    });
  }, [calendarQuery.data?.days, projectionMonth, projectionMetric, total]);

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
  const metricVisible = (name: "Receitas" | "Despesas" | "Resultado") => !selectedMetric || selectedMetric === name;
  const toggleMetric = (name: "Receitas" | "Despesas" | "Resultado") => setSelectedMetric((current) => current === name ? null : name);

  const tooltipStyle = {
    background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 16,
    color: "var(--popover-foreground)", boxShadow: "0 16px 40px rgba(0,0,0,.18)", fontSize: 12,
  };
  const isLoading = daily ? calendarQuery.isPending : trendsQuery.isPending;
  const periodLabel = menuInterval;

  const projectionColor = projectionMetric === "income" ? "var(--income)" : projectionMetric === "expense" ? "var(--expense)" : "var(--finnos-purple-live)";
  const projectionLabel = projectionMetric === "income" ? "Receitas" : projectionMetric === "expense" ? "Despesas" : "Saldo";
  const shiftProjectionMonth = (direction: -1 | 1) => setProjectionMonth((current) => addMonth(current, direction));

  return (
    <div className="border-t border-border/70 pt-5" data-testid="home-financial-chart">
      <div className="mb-4 flex items-center justify-between gap-3">
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
            { name: "Receitas", value: periodSummary.income, icon: ArrowDownLeft, tone: "text-emerald-600 bg-emerald-500/10" },
            { name: "Despesas", value: periodSummary.expense, icon: ArrowUpRight, tone: "text-rose-600 bg-rose-500/10" },
            { name: "Resultado", value: periodSummary.result, icon: Equal, tone: "text-indigo-600 bg-indigo-500/10" },
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
            <span className="text-xs font-medium capitalize text-muted-foreground">{monthLabel(projectionMonth)}</span>
            <button type="button" onClick={() => shiftProjectionMonth(1)} className="rounded-full px-2 py-1 text-lg text-muted-foreground" aria-label="Próximo mês">›</button>
          </div>
          <div className="h-[300px] w-full sm:h-[330px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLineChart data={projectionData} margin={{ top: 16, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="finnosForecastSmoke" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={projectionColor} stopOpacity={0.24} />
                    <stop offset="48%" stopColor={projectionColor} stopOpacity={0.11} />
                    <stop offset="100%" stopColor={projectionColor} stopOpacity={0.015} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.36} strokeDasharray="4 6" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={42} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis tickLine={false} axisLine={false} width={62} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => hidden ? "•••" : `R$ ${Math.round(Number(v) / 1000)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [money(value), name === "actual" ? `${projectionLabel} real` : `${projectionLabel} · estimativa`]} labelFormatter={(label) => `Dia ${label}`} />
                <Area type="monotone" dataKey="forecast" stroke="none" fill="url(#finnosForecastSmoke)" connectNulls={false} />
                <Line type="monotone" dataKey="actual" name="actual" stroke={projectionColor} strokeWidth={3.25} dot={false} activeDot={{ r: 5, fill: projectionColor, stroke: "var(--background)", strokeWidth: 2 }} connectNulls={false} />
                <Line type="monotone" dataKey="forecast" name="forecast" stroke={projectionColor} strokeOpacity={0.78} strokeWidth={2.75} strokeDasharray="8 7" dot={false} activeDot={{ r: 5, fill: "var(--background)", stroke: projectionColor, strokeWidth: 3 }} connectNulls={false} />
              </RechartsLineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
            {([["balance", "Saldo"], ["income", "Receitas"], ["expense", "Despesas"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setProjectionMetric(key)} className={`rounded-full border px-3 py-1.5 font-medium transition-colors ${projectionMetric === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}>
                {label}
              </button>
            ))}
            <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-muted-foreground"><span className="h-0 w-5 border-t-2 border-dashed" style={{ borderColor: projectionColor }} />Estimativa</span>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Arraste para os lados para mudar de mês.</p>
        </div>
      ) : view === "pie" ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-1 sm:min-h-[270px] sm:flex-row sm:gap-10 sm:py-2">
          <div className="relative h-44 w-44 shrink-0 sm:h-48 sm:w-48" onClick={(event) => { if (event.target === event.currentTarget) setSelectedMetric(null); }}>
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
          <div className={`h-[280px] sm:h-[310px] ${view === "bars" && daily ? "min-w-[720px]" : "min-w-0 w-full"}`}>
          <ResponsiveContainer width="100%" height="100%">
            {view === "bars" ? (
              <BarChart data={chartData} margin={{ top: 12, right: 8, left: -8, bottom: 0 }} barGap={3}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={daily ? 18 : 8} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis tickLine={false} axisLine={false} width={62} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => hidden ? "•••" : `R$ ${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  defaultIndex={defaultTooltipIndex}
                  cursor={{ fill: "var(--muted)", opacity: 0.25 }}
                  contentStyle={tooltipStyle}
                  formatter={(value: number) => money(value)}
                  labelFormatter={(label) => daily ? `Dia ${label}` : String(label)}
                />
                {showIncome && metricVisible("Receitas") && <Bar dataKey="Receitas" onClick={() => toggleMetric("Receitas")} className="cursor-pointer" fill={METRIC_UI.Receitas.color} radius={[6, 6, 0, 0]} maxBarSize={22} />}
                {showExpense && metricVisible("Despesas") && <Bar dataKey="Despesas" onClick={() => toggleMetric("Despesas")} className="cursor-pointer" fill={METRIC_UI.Despesas.color} radius={[6, 6, 0, 0]} maxBarSize={22} />}
                {showResult && metricVisible("Resultado") && <Bar dataKey="Resultado" onClick={() => toggleMetric("Resultado")} className="cursor-pointer" fill={METRIC_UI.Resultado.color} radius={[6, 6, 0, 0]} maxBarSize={22} />}
              </BarChart>
            ) : (
              <AreaChart data={chartData} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="finnosResultFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={daily ? 18 : 8} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis tickLine={false} axisLine={false} width={62} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => hidden ? "•••" : `R$ ${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  defaultIndex={defaultTooltipIndex}
                  contentStyle={tooltipStyle}
                  formatter={(value: number) => money(value)}
                  labelFormatter={(label) => daily ? `Dia ${label}` : String(label)}
                />
                {showResult && metricVisible("Resultado") && <Area type="monotone" dataKey="Resultado" onClick={() => toggleMetric("Resultado")} className="cursor-pointer" stroke={METRIC_UI.Resultado.color} strokeWidth={3} fill="url(#finnosResultFill)" activeDot={{ r: 5 }} />}
                {showIncome && metricVisible("Receitas") && <Area type="monotone" dataKey="Receitas" onClick={() => toggleMetric("Receitas")} className="cursor-pointer" stroke={METRIC_UI.Receitas.color} strokeWidth={2.25} fill="transparent" activeDot={{ r: 4 }} />}
                {showExpense && metricVisible("Despesas") && <Area type="monotone" dataKey="Despesas" onClick={() => toggleMetric("Despesas")} className="cursor-pointer" stroke={METRIC_UI.Despesas.color} strokeWidth={2.25} fill="transparent" activeDot={{ r: 4 }} />}
              </AreaChart>
            )}
          </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs" role="group" aria-label="Filtrar série do gráfico">
            <button
              type="button"
              onClick={() => setSelectedMetric(null)}
              className={`rounded-full border px-3 py-1.5 font-medium transition-colors ${selectedMetric === null ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}
            >
              Todos
            </button>
            {showExpense && <button type="button" onClick={() => setSelectedMetric("Despesas")} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-medium transition-colors ${selectedMetric === "Despesas" ? "border-rose-400 bg-rose-500/10 text-rose-600" : "border-border text-muted-foreground"}`}><span className="flex h-5 w-5 items-center justify-center rounded-lg bg-rose-500/10"><ArrowUpRight className="h-3.5 w-3.5 text-rose-400" /></span>Despesas</button>}
            {showIncome && <button type="button" onClick={() => setSelectedMetric("Receitas")} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-medium transition-colors ${selectedMetric === "Receitas" ? "border-emerald-400 bg-emerald-500/10 text-emerald-600" : "border-border text-muted-foreground"}`}><span className="flex h-5 w-5 items-center justify-center rounded-lg bg-emerald-500/10"><ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" /></span>Receitas</button>}
            {showResult && <button type="button" onClick={() => setSelectedMetric("Resultado")} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-medium transition-colors ${selectedMetric === "Resultado" ? "border-violet-400 bg-violet-500/10 text-violet-600" : "border-border text-muted-foreground"}`}><span className="flex h-5 w-5 items-center justify-center rounded-lg bg-violet-500/10"><Equal className="h-3.5 w-3.5 text-violet-400" /></span>Resultado</button>}
          </div>
        </div>
      )}

    </div>
  );
}
