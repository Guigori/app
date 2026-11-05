import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchTrends } from "@/lib/data";
import { currentMonth, monthLabel } from "@/lib/format";
import { evolution } from "@/lib/analysisInsights";
import { useRouteState } from "@/lib/routeState";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { AnalysisHeader, ChartCard, Finding, Segmented, StatTile } from "@/components/analytics/AnalysisKit";
import { axisTick, pct, tooltipStyle, useMoney, axisMoney } from "@/lib/analysisFormat";

/** Análise → Evolução: income vs expenses month by month, how much of the income stays, and the running result. */
export default function AnalysisEvolution() {
  const [months, setMonths] = useRouteState<"6" | "12">("evolucao:months", "6");
  const end = currentMonth();
  const trends = useQuery({ queryKey: ["analysis-trends", Number(months), end], queryFn: () => fetchTrends(Number(months), end) });
  const { hidden, money } = useMoney();
  const data = trends.data ? evolution(trends.data.months) : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-8 animate-fade-up" data-testid="analysis-evolution">
      <AnalysisHeader title="Evolução">
        <Segmented label="Período" value={months} onChange={setMonths} options={[{ value: "6", label: "6 meses" }, { value: "12", label: "1 ano" }]} />
      </AnalysisHeader>
      {trends.isPending ? <FinnosPageLoading title="Montando a evolução" /> : !data ? <p role="alert" className="text-sm text-muted-foreground">Não foi possível carregar a evolução.</p> : <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label="Receita média" value={money(data.avgIncome)} tone="income" note="por mês com movimento" />
          <StatTile label="Despesa média" value={money(data.avgExpense)} tone="expense" note="por mês com movimento" />
          <StatTile label="Você guarda" value={data.avgRate === null ? "—" : pct(data.avgRate)} note="da renda, em média" />
        </div>

        {data.best ? (
          <Finding tone={data.avgRate !== null && data.avgRate >= 10 ? "good" : "attention"}>
            Melhor mês: <strong>{monthLabel(data.best.month)}</strong> ({money(data.best.net)}).
            {data.worst ? <> Mais apertado: <strong>{monthLabel(data.worst.month)}</strong> ({money(data.worst.net)}).</> : null}
            {data.avgRate !== null ? (data.avgRate >= 20 ? " Você guarda acima de 20% da renda: ótimo ritmo." : data.avgRate >= 10 ? " Guardar 20% da renda é uma boa meta para os próximos meses." : " As despesas estão consumindo quase toda a renda: vale olhar as categorias que mais cresceram.") : null}
          </Finding>
        ) : null}

        <ChartCard title="Receitas e despesas" subtitle="Por mês" legend={[{ label: "Receitas", color: "var(--income)" }, { label: "Despesas", color: "var(--expense)" }]}>
          <div className="h-56 w-full" data-testid="evolution-bars">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.months} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                <YAxis hide={hidden} width={44} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={axisMoney} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v: number, name: string) => [money(v), name === "income" ? "Receitas" : "Despesas"]} />
                <Bar dataKey="income" fill="var(--income)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="expense" fill="var(--expense)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Quanto da renda sobrou" subtitle="Resultado ÷ receitas de cada mês">
            <div className="h-48 w-full" data-testid="evolution-rate">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.months.map((m) => ({ ...m, rate: m.rate ?? 0 }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                  <YAxis width={40} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v: number) => `${v}%`} />
                  <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v: number) => [pct(v), "Da renda"]} />
                  <Bar dataKey="rate" radius={[4, 4, 4, 4]} maxBarSize={22}>{data.months.map((m) => <Cell key={m.month} fill={(m.rate ?? 0) < 0 ? "var(--expense)" : "var(--primary)"} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
          <ChartCard title="Resultado acumulado" subtitle="Soma do que sobrou (ou faltou) mês a mês">
            <div className="h-48 w-full" data-testid="evolution-cumulative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.months} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="evo-cum" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                  <YAxis hide={hidden} width={44} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={axisMoney} />
                  <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [money(v), "Acumulado"]} />
                  <Area type="monotone" dataKey="cumulative" stroke="var(--primary)" strokeWidth={2} fill="url(#evo-cum)" dot={{ r: 3, strokeWidth: 0, fill: "var(--primary)" }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <ChartCard title="Mês a mês" subtitle="Os números por trás dos gráficos">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm tabular-nums">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2 font-medium">Mês</th><th className="py-2 text-right font-medium">Receitas</th><th className="py-2 text-right font-medium">Despesas</th><th className="py-2 text-right font-medium">Sobrou</th></tr></thead>
              <tbody className="divide-y divide-border">
                {[...data.months].reverse().map((m) => (
                  <tr key={m.month}><td className="py-2 capitalize">{m.label}</td><td className="py-2 text-right">{money(m.income)}</td><td className="py-2 text-right">{money(m.expense)}</td><td className={"py-2 text-right font-semibold " + (m.net < 0 ? "text-expense" : "")}>{money(m.net)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </>}
    </div>
  );
}
