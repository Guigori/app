import { Link, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { fetchDashboard } from "@/lib/data";
import { currentMonth, monthLabel } from "@/lib/format";
import { addMonths, categoryChanges } from "@/lib/analysisInsights";
import { useRouteState } from "@/lib/routeState";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { AnalysisHeader, StatGrid, ChartCard, Finding, StatTile } from "@/components/analytics/AnalysisKit";
import { axisTick, pct, tooltipStyle, tooltipItemStyle, tooltipLabelStyle, useMoney } from "@/lib/analysisFormat";

const shortMonth = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");

/** Análise → Categorias: where the money went, what changed vs last month, and each top category's trend. */
export default function AnalysisCategories() {
  const [params] = useSearchParams();
  const [month, setMonth] = useRouteState("categorias:month", () => params.get("month") ?? currentMonth());
  const { hidden, money, short } = useMoney();
  const current = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month) });
  const previous = useQuery({ queryKey: ["dashboard", addMonths(month, -1)], queryFn: () => fetchDashboard(addMonths(month, -1)) });
  const history = useQueries({ queries: [5, 4, 3, 2, 1, 0].map((back) => ({ queryKey: ["dashboard", addMonths(month, -back)], queryFn: () => fetchDashboard(addMonths(month, -back)) })) });

  const changes = current.data && previous.data ? categoryChanges(current.data.categories, previous.data.categories) : [];
  const spending = changes.filter((c) => c.current > 0);
  const top = spending.slice(0, 8);
  const rising = [...changes].filter((c) => c.delta > 0.5).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const falling = [...changes].filter((c) => c.delta < -0.5).sort((a, b) => a.delta - b.delta).slice(0, 3);
  const total = current.data?.expense ?? 0;
  const prevTotal = previous.data?.expense ?? 0;
  const ready = history.every((h) => h.data);
  const trendOf = (id: string) => history.map((h, i) => ({ month: shortMonth(addMonths(month, -(5 - i))), value: h.data?.categories.find((c) => (c.category_id ?? `name:${c.name}`) === id)?.total ?? 0 }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-8 animate-fade-up" data-testid="analysis-categories">
      <AnalysisHeader title="Categorias" month={month} onMonthChange={setMonth} />
      {current.isPending || previous.isPending ? <FinnosPageLoading title="Somando categorias" /> : <>
        <StatGrid>
          <StatTile label="Gasto no mês" value={money(total)} tone="expense" note={prevTotal > 0 ? `${total >= prevTotal ? "▲" : "▼"} ${pct(Math.abs(((total - prevTotal) / prevTotal) * 100))} vs. ${monthLabel(addMonths(month, -1))}` : "sem mês anterior para comparar"} />
          <StatTile label="Categorias com gasto" value={String(spending.length)} />
          <StatTile label="Maior peso" value={spending[0] ? spending[0].name : "—"} note={spending[0] && total > 0 ? `${pct((spending[0].current / total) * 100)} do mês` : undefined} />
        </StatGrid>

        {rising[0] ? <Finding tone="attention"><strong>{rising[0].name}</strong> subiu {money(rising[0].delta)}{rising[0].deltaPct !== null ? ` (${pct(rising[0].deltaPct)})` : " e não aparecia no mês anterior"} em relação a {monthLabel(addMonths(month, -1))}.</Finding>
          : falling[0] ? <Finding tone="good"><strong>{falling[0].name}</strong> caiu {money(Math.abs(falling[0].delta))} em relação ao mês anterior.</Finding> : null}

        <ChartCard title="Onde foi o dinheiro" subtitle="As maiores categorias do mês">
          {top.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhum gasto categorizado neste mês.</p> : (
            <div className="w-full" style={{ height: Math.max(top.length * 40, 120) }} data-testid="categories-ranking">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }} barCategoryGap={8}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={104} tickLine={false} axisLine={false} tick={{ ...axisTick, fill: "var(--foreground)" }} />
                  <Tooltip active defaultIndex={0} contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} cursor={{ fill: "var(--muted)" }} formatter={(v: number) => [`${money(v)}${total > 0 ? ` · ${pct((v / total) * 100)}` : ""}`, "Gasto"]} />
                  <Bar dataKey="current" radius={[0, 4, 4, 0]} maxBarSize={22} label={hidden ? undefined : { position: "right", formatter: (v: unknown) => short(Number(v)), fill: "var(--muted-foreground)", fontSize: 12 }}>
                    {top.map((c) => <Cell key={c.id} fill={c.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Subiram" subtitle={`vs. ${monthLabel(addMonths(month, -1))}`}>
            {rising.length ? <ul className="divide-y divide-border">{rising.map((c) => <ChangeRow key={c.id} change={c} money={money} month={month} />)}</ul> : <p className="py-4 text-sm text-muted-foreground">Nenhuma categoria subiu.</p>}
          </ChartCard>
          <ChartCard title="Caíram" subtitle={`vs. ${monthLabel(addMonths(month, -1))}`}>
            {falling.length ? <ul className="divide-y divide-border">{falling.map((c) => <ChangeRow key={c.id} change={c} money={money} month={month} />)}</ul> : <p className="py-4 text-sm text-muted-foreground">Nenhuma categoria caiu.</p>}
          </ChartCard>
        </div>

        {/* Small multiples: same scale per card is not needed; each answers "is this category growing?" */}
        <ChartCard title="Tendência das maiores" subtitle="Últimos 6 meses de cada categoria">
          {!ready ? <div className="h-32 animate-pulse rounded-xl bg-muted" /> : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="categories-trends">
              {spending.slice(0, 4).map((c) => {
                const series = trendOf(c.id);
                return (
                  <Link key={c.id} to={`/transacoes?month=${month}&metric=despesas${c.id.startsWith("name:") ? "" : `&category_id=${encodeURIComponent(c.id)}`}`} className="rounded-xl border border-border p-3 transition-colors hover:bg-muted/40">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />{c.name}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{money(c.current)}</p>
                    <div className="mt-2 h-14">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={series} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                          <XAxis dataKey="month" hide />
                          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [money(v), c.name]} labelFormatter={(l: string) => l} />
                          <Area type="monotone" dataKey="value" stroke={c.color} strokeWidth={2} fill={c.color} fillOpacity={0.12} dot={false} activeDot={{ r: 4 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </ChartCard>
      </>}
    </div>
  );
}

function ChangeRow({ change, money, month }: { change: ReturnType<typeof categoryChanges>[number]; money: (v: number) => string; month: string }) {
  const up = change.delta > 0;
  return (
    <li>
      <Link to={`/transacoes?month=${month}&metric=despesas${change.id.startsWith("name:") ? "" : `&category_id=${encodeURIComponent(change.id)}`}`} className="flex items-center gap-3 py-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${change.color}1A`, color: change.color }}><CategoryIcon name={change.icon} className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{change.name}</span><span className="block text-xs tabular-nums text-muted-foreground">{money(change.previous)} → {money(change.current)}</span></span>
        <span className={"flex shrink-0 items-center gap-0.5 text-sm font-semibold tabular-nums " + (up ? "text-expense" : "text-income")}>
          {up ? <ArrowUpRight className="h-4 w-4" aria-label="subiu" /> : <ArrowDownRight className="h-4 w-4" aria-label="caiu" />}
          {money(Math.abs(change.delta))}
        </span>
      </Link>
    </li>
  );
}
