import { Link, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pinIndex } from "@/lib/chartPin";
import { fetchCalendar, fetchTransactions } from "@/lib/data";
import { currentMonth, formatDate, monthLabel, todayISO } from "@/lib/format";
import { addMonths, daysInMonth, monthPortion, rhythm, weekdayAverages } from "@/lib/analysisInsights";
import { useRouteState } from "@/lib/routeState";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { AnalysisHeader, ChartCard, Finding, StatTile } from "@/components/analytics/AnalysisKit";
import { axisTick, pct, tooltipStyle, useMoney, axisMoney } from "@/lib/analysisFormat";

/** Análise → Ritmo: how fast the month is going, where it ends at this pace, which weekdays cost more, and the biggest expenses. */
export default function AnalysisRhythm() {
  const [params] = useSearchParams();
  const [month, setMonth] = useRouteState("ritmo:month", () => params.get("month") ?? currentMonth());
  const today = todayISO();
  const { hidden, money } = useMoney();
  const calendars = useQueries({ queries: [0, 1, 2].map((back) => ({ queryKey: ["calendar", addMonths(month, -back)], queryFn: () => fetchCalendar(addMonths(month, -back)) })) });
  const transactions = useQuery({ queryKey: ["transactions", "analysis-all"], queryFn: () => fetchTransactions({ start_date: "1900-01-01", end_date: "2999-12-31" }) });
  const [now, prev, older] = calendars.map((c) => c.data);
  const data = now && prev ? rhythm(month, now.days, prev.days, today) : null;
  const weekdays = now && prev && older ? weekdayAverages([...now.days, ...prev.days, ...older.days], today) : [];
  const maxWeekday = weekdays.reduce((m, w, i, all) => (w.average > (all[m]?.average ?? 0) ? i : m), 0);
  const prevTotal = prev?.expense ?? 0;
  const biggest = (transactions.data ?? [])
    .filter((t) => t.type === "despesa")
    .map((t) => ({ t, amount: monthPortion(t, month) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-8 animate-fade-up" data-testid="analysis-rhythm">
      <AnalysisHeader title="Ritmo do mês" month={month} onMonthChange={setMonth} />
      {!data ? <FinnosPageLoading title="Calculando o ritmo" /> : <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label={data.projection !== null ? "Gasto até hoje" : "Gasto no mês"} value={money(data.spent)} tone="expense" note={`${data.daysElapsed} dias`} />
          <StatTile label="Média por dia" value={money(data.dailyAverage)} />
          <StatTile label={data.projection !== null ? "Se continuar assim" : `${monthLabel(addMonths(month, -1))}`} value={money(data.projection ?? prevTotal)} note={data.projection !== null && prevTotal > 0 ? `${data.projection > prevTotal ? "▲" : "▼"} ${pct(Math.abs(((data.projection - prevTotal) / prevTotal) * 100))} vs. mês anterior` : data.projection !== null ? "projeção do mês" : "mês anterior"} />
        </div>

        {data.projection !== null && prevTotal > 0 ? (
          <Finding tone={data.projection > prevTotal ? "attention" : "good"}>
            {data.projection > prevTotal
              ? <>No ritmo atual, o mês fecha em <strong>{money(data.projection)}</strong>, {money(data.projection - prevTotal)} acima de {monthLabel(addMonths(month, -1))}. Para empatar, a média dos próximos dias precisa ficar em {money(Math.max(prevTotal - data.spent, 0) / Math.max(daysInMonth(month) - data.daysElapsed, 1))}.</>
              : <>No ritmo atual, o mês fecha em <strong>{money(data.projection)}</strong>, {money(prevTotal - data.projection)} abaixo de {monthLabel(addMonths(month, -1))}. Bom ritmo.</>}
          </Finding>
        ) : null}

        <ChartCard title="Gasto acumulado" subtitle="Dia a dia, comparado ao mês anterior" legend={[{ label: monthLabel(month), color: "var(--primary)" }, { label: monthLabel(addMonths(month, -1)), color: "var(--muted-foreground)", dashed: true }]}>
          <div className="h-56 w-full" data-testid="rhythm-curve">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.curve} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} interval={4} />
                <YAxis hide={hidden} width={44} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={axisMoney} />
                <Tooltip active defaultIndex={pinIndex(data.curve, (p) => month === today.slice(0, 7) && p.day === Number(today.slice(8, 10)))} contentStyle={tooltipStyle} labelFormatter={(d: number) => `Dia ${d}`} formatter={(v: number, name: string) => [money(v), name === "current" ? monthLabel(month) : monthLabel(addMonths(month, -1))]} />
                <Line type="monotone" dataKey="previous" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="current" stroke="var(--primary)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Dias da semana" subtitle="Gasto médio por dia, últimos 3 meses">
            <div className="h-48 w-full" data-testid="rhythm-weekdays">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekdays} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                  <YAxis hide width={0} />
                  <Tooltip active defaultIndex={maxWeekday} contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v: number) => [money(v), "Média"]} />
                  {/* Emphasis: the costliest weekday in primary, the rest recessive. */}
                  <Bar dataKey="average" radius={[4, 4, 0, 0]} maxBarSize={28}>
                    {weekdays.map((w, i) => <Cell key={w.label} fill={i === maxWeekday ? "var(--primary)" : "color-mix(in srgb, var(--primary) 28%, var(--card))"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {weekdays[maxWeekday]?.average ? <p className="mt-2 text-xs text-muted-foreground">Você gasta mais às <strong className="text-foreground">{["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"][maxWeekday]}</strong>: {money(weekdays[maxWeekday].average)} em média.</p> : null}
          </ChartCard>

          <ChartCard title="Maiores gastos do mês" subtitle="Parcelas contam pelo valor do mês">
            {biggest.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum gasto neste mês.</p> : (
              <ul className="divide-y divide-border" data-testid="rhythm-biggest">
                {biggest.map(({ t, amount }) => (
                  <li key={t.id}>
                    <Link to={`/transacoes?date=${t.date}&highlight=${t.id}`} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{t.name}</span><span className="block text-xs text-muted-foreground">{formatDate(t.date)}{t.category_name ? ` · ${t.category_name}` : ""}{t.installment ? ` · parcela` : ""}</span></span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-expense">{money(amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      </>}
    </div>
  );
}
