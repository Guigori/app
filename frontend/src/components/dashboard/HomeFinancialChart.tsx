import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { BarChart3, ChartPie, LayoutGrid, LineChart, SlidersHorizontal } from "lucide-react";
import { fetchCalendar, fetchTrends } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
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
  const [selectedPie, setSelectedPie] = useState<string | null>(null);

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

    const [year, monthNumber] = month.split("-").map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const byDate = new Map((calendarQuery.data?.days ?? []).map((day) => [day.date, day]));
    let cumulativeIncome = 0;
    let cumulativeExpense = 0;
    const rows = Array.from({ length: daysInMonth }, (_, index) => {
      const dayNumber = index + 1;
      const date = `${month}-${String(dayNumber).padStart(2, "0")}`;
      const day = byDate.get(date);
      cumulativeIncome += day?.income ?? 0;
      cumulativeExpense += day?.expense ?? 0;
      return {
        date,
        label: String(dayNumber).padStart(2, "0"),
        Receitas: Math.round(cumulativeIncome * 100) / 100,
        Despesas: Math.round(cumulativeExpense * 100) / 100,
        Resultado: Math.round((cumulativeIncome - cumulativeExpense) * 100) / 100,
      };
    });
    return period === "7d" ? rows.slice(-7) : rows;
  }, [calendarQuery.data, daily, month, period, trendsQuery.data]);

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
    { name: "Receitas", value: Math.max(periodSummary.income, 0), fill: "var(--income)", metric: "income" as MetricKind },
    { name: "Despesas", value: Math.max(periodSummary.expense, 0), fill: "var(--expense)", metric: "expense" as MetricKind },
    { name: "Resultado", value: Math.max(periodSummary.result, 0), fill: "var(--primary)", metric: "balance" as MetricKind },
  ].filter((item) => item.value > 0);
  const selectedPieItem = selectedPie ? pieData.find((item) => item.name === selectedPie) ?? null : null;
  const visiblePieItems = selectedPieItem ? [selectedPieItem] : pieData;

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
        <Button variant="outline" size="icon" className="h-10 w-10 rounded-full bg-background/70 shadow-sm" onClick={() => setFiltersOpen(true)} aria-label="Personalizar gráfico" data-testid="home-chart-filter-button">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      {view === "cards" ? (
        <div className="py-1 text-sm text-muted-foreground">
          O resumo principal acima já mostra saldo, receitas e despesas. Use os filtros para alternar para Linhas, Pizza ou Barras.
        </div>
      ) : isLoading ? (
        <div className="h-[270px] animate-pulse rounded-2xl bg-muted/50" />
      ) : view === "pie" ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-1 sm:min-h-[270px] sm:flex-row sm:gap-10 sm:py-2">
          <div className="relative h-44 w-44 shrink-0 sm:h-48 sm:w-48" onClick={() => setSelectedPie(null)}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => money(value)} />
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="98%" paddingAngle={2} cornerRadius={6} strokeWidth={0} onClick={(_, index) => { const item = pieData[index]; if (item) setSelectedPie(selectedPie === item.name ? null : item.name); }}>
                  {pieData.map((entry) => <Cell key={entry.name} fill={entry.fill} opacity={selectedPie && selectedPie !== entry.name ? 0.22 : 1} className="cursor-pointer" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-muted-foreground">Saldo total</span>
              <strong className="mt-1 max-w-[8rem] truncate font-heading text-lg font-bold tabular-nums text-foreground">{money(total)}</strong>
            </div>
          </div>
          <div className="w-full max-w-xs space-y-2">
            {pieData.map((entry) => (
              <div key={entry.name} className="flex items-center justify-between gap-5 rounded-xl px-2 py-2 hover:bg-muted/40">
                <span className="flex items-center gap-2 text-sm text-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ background: entry.fill }} />{entry.name}</span>
                <strong className="font-heading text-sm tabular-nums text-foreground">{money(entry.value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="h-[280px] w-full sm:h-[310px]">
          <ResponsiveContainer width="100%" height="100%">
            {view === "bars" ? (
              <BarChart data={chartData} margin={{ top: 12, right: 8, left: -8, bottom: 0 }} barGap={3}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={daily ? 18 : 8} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis tickLine={false} axisLine={false} width={62} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => hidden ? "•••" : `R$ ${Math.round(Number(v) / 1000)}k`} />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.25 }} contentStyle={tooltipStyle} formatter={(value: number) => money(value)} labelFormatter={(label) => daily ? `Dia ${label}` : String(label)} />
                {showIncome && <Bar dataKey="Receitas" fill="var(--income)" radius={[6, 6, 0, 0]} maxBarSize={18} />}
                {showExpense && <Bar dataKey="Despesas" fill="var(--expense)" radius={[6, 6, 0, 0]} maxBarSize={18} />}
                {showResult && <Bar dataKey="Resultado" fill="var(--primary)" radius={[6, 6, 0, 0]} maxBarSize={18} />}
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
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => money(value)} labelFormatter={(label) => daily ? `Dia ${label}` : String(label)} />
                {showResult && <Area type="monotone" dataKey="Resultado" stroke="var(--primary)" strokeWidth={3} fill="url(#finnosResultFill)" activeDot={{ r: 5 }} />}
                {showIncome && <Area type="monotone" dataKey="Receitas" stroke="var(--income)" strokeWidth={2.25} fill="transparent" activeDot={{ r: 4 }} />}
                {showExpense && <Area type="monotone" dataKey="Despesas" stroke="var(--expense)" strokeWidth={2.25} fill="transparent" activeDot={{ r: 4 }} />}
              </AreaChart>
            )}
          </ResponsiveContainer>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs">
            {showExpense && <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-expense" />Despesas</span>}
            {showIncome && <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-income" />Receitas</span>}
            {showResult && <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" />Resultado</span>}
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
