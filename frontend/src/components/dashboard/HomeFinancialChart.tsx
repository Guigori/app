import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowDownLeft, ArrowUpRight, BarChart3, ChartPie, Equal, LayoutGrid, LineChart, SlidersHorizontal } from "lucide-react";
import { fetchCalendar, fetchTrends } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { buildMonthlyCumulativeRows, defaultDailyTooltipIndex, selectVisibleDailyRows } from "@/lib/homeChart";
import type { MetricKind } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type ChartView = "cards" | "line" | "pie" | "bars";
type ChartPeriod = "7d" | "1m" | "6m" | "1y";

interface HomeFinancialChartProps {
  month: string;
  total: number;
  income: number;
  expense: number;
  result: number;
  onOpenMetric: (metric: MetricKind) => void;
}

const VIEW_OPTIONS: Array<{ key: ChartView; label: string; icon: typeof LayoutGrid }> = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "line", label: "Linhas", icon: LineChart },
  { key: "pie", label: "Pizza", icon: ChartPie },
  { key: "bars", label: "Barras", icon: BarChart3 },
];

const METRIC_UI = {
  Receitas: { icon: ArrowDownLeft, color: "#22c997", soft: "bg-emerald-500/10 text-emerald-400" },
  Despesas: { icon: ArrowUpRight, color: "#ff4d6d", soft: "bg-rose-500/10 text-rose-400" },
  Resultado: { icon: Equal, color: "#8b5cf6", soft: "bg-violet-500/10 text-violet-400" },
} as const;

const PERIODS: Array<{ value: ChartPeriod; label: string }> = [
  { value: "7d", label: "7 dias" },
  { value: "1m", label: "1 mês" },
  { value: "6m", label: "6 meses" },
  { value: "1y", label: "1 ano" },
];

export function HomeFinancialChart({ month, total, income, expense, result, onOpenMetric }: HomeFinancialChartProps) {
  const { hidden } = useBalanceHidden();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<ChartView>("line");
  const [period, setPeriod] = useState<ChartPeriod>("1m");
  const [showIncome, setShowIncome] = useState(true);
  const [showExpense, setShowExpense] = useState(true);
  const [showResult, setShowResult] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<"Receitas" | "Despesas" | "Resultado" | null>(null);

  const daily = period === "7d" || period === "1m";
  const calendarQuery = useQuery({
    queryKey: ["home-financial-calendar", month],
    queryFn: () => fetchCalendar(month),
    enabled: daily,
  });
  const trendsQuery = useQuery({
    queryKey: ["home-financial-trends", period, month],
    queryFn: () => fetchTrends(period === "1y" ? 12 : 6, month),
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

    const rows = buildMonthlyCumulativeRows(month, calendarQuery.data?.days ?? []);
    return selectVisibleDailyRows(rows, month, period, todayISO());
  }, [calendarQuery.data, daily, month, period, trendsQuery.data]);

  const defaultTooltipIndex = useMemo(
    () => daily ? defaultDailyTooltipIndex(chartData, month, todayISO()) : undefined,
    [chartData, daily, month],
  );

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
  const periodLabel = PERIODS.find((item) => item.value === period)?.label ?? "1 mês";

  return (
    <div className="border-t border-border/70 pt-5" data-testid="home-financial-chart">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">Saldo ao longo do tempo</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {view === "cards" ? "Resumo financeiro" : view === "pie" ? "Composição do período" : `Evolução · ${periodLabel}`}
          </p>
        </div>
        <Button variant="outline" size="icon" className="absolute right-0 top-[7rem] z-20 h-10 w-10 rounded-full bg-background/70 shadow-sm sm:right-0 sm:top-[7.25rem]" onClick={() => setFiltersOpen(true)} aria-label="Personalizar gráfico" data-testid="home-chart-filter-button">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
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
        <div className="w-full overflow-x-auto pb-1 [scrollbar-width:none]">
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
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs">
            {showExpense && <button type="button" onClick={() => toggleMetric("Despesas")} className="flex items-center gap-1.5 text-muted-foreground"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-rose-500/10"><ArrowUpRight className="h-3.5 w-3.5 text-rose-400" /></span>Despesas</button>}
            {showIncome && <button type="button" onClick={() => toggleMetric("Receitas")} className="flex items-center gap-1.5 text-muted-foreground"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/10"><ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" /></span>Receitas</button>}
            {showResult && <button type="button" onClick={() => toggleMetric("Resultado")} className="flex items-center gap-1.5 text-muted-foreground"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/10"><Equal className="h-3.5 w-3.5 text-violet-400" /></span>Resultado</button>}
          </div>
        </div>
      )}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-[94vw] max-w-md border-border/70 bg-background/95 backdrop-blur-xl">
          <SheetHeader className="border-b border-border/70 px-6 py-6">
            <SheetTitle className="text-xl font-semibold">Personalizar visualização</SheetTitle>
            <SheetDescription className="mt-1">Ajuste o gráfico sem ocupar espaço na Home.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
            <fieldset>
              <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Visualização</legend>
              <div className="grid grid-cols-2 gap-3">
                {VIEW_OPTIONS.map((option) => (
                  <button key={option.key} type="button" onClick={() => setView(option.key)} className={`flex min-h-12 items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors ${view === option.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted/60"}`}>
                    <option.icon className="h-4 w-4" />{option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Período</legend>
              <div className="grid grid-cols-2 gap-3">
                {PERIODS.map((option) => (
                  <button key={option.value} type="button" onClick={() => setPeriod(option.value)} className={`min-h-11 rounded-2xl border px-3 py-2.5 text-sm font-medium transition-colors ${period === option.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted/60"}`}>{option.label}</button>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Em 7 dias e 1 mês, o gráfico mostra a evolução dia a dia. Em 6 meses e 1 ano, compara os meses.</p>
            </fieldset>
            {view !== "cards" && view !== "pie" && (
              <fieldset>
                <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Exibir no gráfico</legend>
                <div className="space-y-2.5">
                  {[
                    ["Receitas", showIncome, setShowIncome],
                    ["Despesas", showExpense, setShowExpense],
                    ["Resultado", showResult, setShowResult],
                  ].map(([label, checked, setter]) => (
                    <label key={String(label)} className="flex min-h-12 cursor-pointer items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-sm">
                      <span>{String(label)}</span>
                      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="h-4 w-4 accent-primary" />
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
          <SheetFooter className="border-t border-border/70 bg-background/90 p-6">
            <Button className="h-11 w-full rounded-xl" onClick={() => setFiltersOpen(false)}>Aplicar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
