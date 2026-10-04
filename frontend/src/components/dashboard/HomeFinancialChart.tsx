import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, ChartPie, LayoutGrid, LineChart, SlidersHorizontal } from "lucide-react";
import { fetchTrends } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import type { MetricKind } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type ChartView = "cards" | "line" | "pie" | "bars";
type ChartPeriod = 1 | 6 | 12;

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
  { value: 1, label: "1 mês" },
  { value: 6, label: "6 meses" },
  { value: 12, label: "1 ano" },
];

export function HomeFinancialChart({ month, total, income, expense, result, onOpenMetric }: HomeFinancialChartProps) {
  const { hidden } = useBalanceHidden();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<ChartView>("line");
  const [period, setPeriod] = useState<ChartPeriod>(6);
  const [showIncome, setShowIncome] = useState(true);
  const [showExpense, setShowExpense] = useState(true);
  const [showResult, setShowResult] = useState(true);
  const trendsQuery = useQuery({ queryKey: ["home-financial-chart", period, month], queryFn: () => fetchTrends(period, month) });
  const trends = trendsQuery.data?.months ?? [];
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  const chartData = trends.map((item) => ({
    label: item.label,
    Receitas: item.income,
    Despesas: item.expense,
    Resultado: item.net,
  }));
  const pieData = [
    ...(showIncome ? [{ name: "Receitas", value: Math.max(income, 0), fill: "var(--income)" }] : []),
    ...(showExpense ? [{ name: "Despesas", value: Math.max(expense, 0), fill: "var(--expense)" }] : []),
    ...(showResult ? [{ name: "Resultado", value: Math.max(result, 0), fill: "var(--primary)" }] : []),
  ].filter((item) => item.value > 0);

  const tooltipStyle = {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    color: "var(--popover-foreground)",
    boxShadow: "0 16px 40px rgba(0,0,0,.18)",
    fontSize: 12,
  };

  return (
    <section className="overflow-hidden rounded-[26px] border border-border/70 bg-card/95 shadow-sm" data-testid="home-financial-chart">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">Saldo ao longo do tempo</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {view === "cards" ? "Resumo financeiro" : view === "line" ? "Evolução financeira" : view === "pie" ? "Composição do período" : "Comparação por período"}
          </p>
        </div>
        <Button variant="outline" size="icon" className="rounded-xl" onClick={() => setFiltersOpen(true)} aria-label="Personalizar gráfico" data-testid="home-chart-filter-button">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      {view === "cards" ? (
        <div className="grid grid-cols-2 divide-x divide-y divide-border/70 sm:grid-cols-4 sm:divide-y-0">
          {[
            ["Saldo total", total, "balance" as MetricKind],
            ["Receitas", income, "income" as MetricKind],
            ["Despesas", expense, "expense" as MetricKind],
            ["Resultado", result, "balance" as MetricKind],
          ].map(([label, value, metric]) => (
            <button key={String(label)} type="button" onClick={() => onOpenMetric(metric as MetricKind)} className="p-5 text-left transition-colors hover:bg-muted/40">
              <p className="text-xs font-medium text-muted-foreground">{String(label)}</p>
              <p className="mt-2 font-heading text-xl font-bold tabular-nums text-foreground">{money(Number(value))}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-2 pb-3 pt-4 sm:px-5">
          {trendsQuery.isPending ? (
            <div className="h-[280px] animate-pulse rounded-2xl bg-muted/60" />
          ) : view === "pie" ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => money(value)} />
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="78%" paddingAngle={2} stroke="var(--card)" strokeWidth={3}>
                    {pieData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                  </Pie>
                  <Legend iconType="circle" iconSize={7} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : view === "bars" ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 12, right: 10, left: 0, bottom: 0 }} barGap={4}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.55} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tickLine={false} axisLine={false} width={58} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => hidden ? "•••" : `R$ ${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.3 }} contentStyle={tooltipStyle} formatter={(value: number) => money(value)} />
                  {showIncome && <Bar dataKey="Receitas" fill="var(--income)" radius={[7, 7, 0, 0]} maxBarSize={22} />}
                  {showExpense && <Bar dataKey="Despesas" fill="var(--expense)" radius={[7, 7, 0, 0]} maxBarSize={22} />}
                  {showResult && <Bar dataKey="Resultado" fill="var(--primary)" radius={[7, 7, 0, 0]} maxBarSize={22} />}
                  <Legend iconType="circle" iconSize={7} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="finnosResultFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.55} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tickLine={false} axisLine={false} width={58} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => hidden ? "•••" : `R$ ${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => money(value)} />
                  {showResult && <Area type="monotone" dataKey="Resultado" stroke="var(--primary)" strokeWidth={3} fill="url(#finnosResultFill)" activeDot={{ r: 5 }} />}
                  {showIncome && <Area type="monotone" dataKey="Receitas" stroke="var(--income)" strokeWidth={2.25} fill="transparent" activeDot={{ r: 4 }} />}
                  {showExpense && <Area type="monotone" dataKey="Despesas" stroke="var(--expense)" strokeWidth={2.25} fill="transparent" activeDot={{ r: 4 }} />}
                  <Legend iconType="circle" iconSize={7} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-[92vw] max-w-md border-border/70 bg-background/95 backdrop-blur-xl">
          <SheetHeader className="border-b border-border/70 px-5 py-5">
            <SheetTitle className="text-lg font-semibold">Personalizar visualização</SheetTitle>
            <SheetDescription>Escolha como os dados financeiros aparecem na Home.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-7 overflow-y-auto px-5 py-2">
            <fieldset>
              <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Visualização</legend>
              <div className="grid grid-cols-2 gap-2">
                {VIEW_OPTIONS.map((option) => (
                  <button key={option.key} type="button" onClick={() => setView(option.key)} className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${view === option.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted/60"}`}>
                    <option.icon className="h-4 w-4" />{option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Período</legend>
              <div className="grid grid-cols-3 gap-2">
                {PERIODS.map((option) => (
                  <button key={option.value} type="button" onClick={() => setPeriod(option.value)} className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${period === option.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"}`}>{option.label}</button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">7 dias e período personalizado entram quando o histórico diário estiver disponível no backend.</p>
            </fieldset>
            {view !== "cards" && (
              <fieldset>
                <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Exibir</legend>
                <div className="space-y-2">
                  {[
                    ["Receitas", showIncome, setShowIncome],
                    ["Despesas", showExpense, setShowExpense],
                    ["Resultado", showResult, setShowResult],
                  ].map(([label, checked, setter]) => (
                    <label key={String(label)} className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-card px-3 py-3 text-sm">
                      <span>{String(label)}</span>
                      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="h-4 w-4 accent-primary" />
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
          <SheetFooter className="border-t border-border/70 p-5">
            <Button className="w-full rounded-xl" onClick={() => setFiltersOpen(false)}>Aplicar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
