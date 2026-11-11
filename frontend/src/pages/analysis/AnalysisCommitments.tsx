import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pinIndex } from "@/lib/chartPin";
import { fetchCards, fetchDashboard, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { InstallmentsInsight, InvoicesInsight } from "@/components/insights";
import { currentMonth } from "@/lib/format";
import { commitments } from "@/lib/analysisInsights";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { AnalysisHeader, StatGrid, ChartCard, Finding, StatTile } from "@/components/analytics/AnalysisKit";
import { axisTick, pct, tooltipStyle, tooltipItemStyle, tooltipLabelStyle, useMoney, axisMoney } from "@/lib/analysisFormat";

const monthShort = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");

/** Análise → Compromissos: what the next months already owe (installments + fixed costs and subscriptions). */
export default function AnalysisCommitments() {
  const month = currentMonth();
  const { hidden, money } = useMoney();
  const transactions = useQuery({ queryKey: ["transactions", "analysis-all"], queryFn: () => fetchTransactions({ start_date: "1900-01-01", end_date: "2999-12-31" }) });
  const subscriptions = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards, staleTime: 60_000 });
  const dashboard = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month) });
  const data = transactions.data ? commitments(transactions.data, subscriptions.data?.items ?? [], month, 6) : null;
  const sixMonths = data ? data.months.reduce((s, m) => s + m.total, 0) : 0;
  const income = dashboard.data?.prev_income || dashboard.data?.income || 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-8 animate-fade-up" data-testid="analysis-commitments">
      <AnalysisHeader title="Compromissos" />
      {!data ? <FinnosPageLoading title="Somando compromissos" /> : <>
        <StatGrid>
          <StatTile label="Fixos por mês" value={money(data.fixedMonthly)} note={`${data.fixedItems.length} contas e assinaturas`} />
          <StatTile label="Parcelas neste mês" value={money(data.months[0]?.installments ?? 0)} note={`${data.installmentItems.length} compras parceladas`} />
          <StatTile label="Próximos 6 meses" value={money(sixMonths)} note="já comprometidos" tone="expense" />
        </StatGrid>

        {income > 0 && data.months[0] ? (
          <Finding tone={data.months[0].total / income > 0.6 ? "attention" : "neutral"}>
            Antes de qualquer gasto novo, <strong>{pct((data.months[0].total / income) * 100)}</strong> da sua renda deste mês já tem destino (fixos + parcelas).
            {data.months.at(-1) && data.months.at(-1)!.installments < (data.months[0].installments) ? ` As parcelas diminuem até ${monthShort(data.months.at(-1)!.month)}, liberando ${money(data.months[0].installments - data.months.at(-1)!.installments)} por mês.` : ""}
          </Finding>
        ) : null}

        {cards.data?.some((c) => c.active) ? <InvoicesInsight cards={cards.data} /> : null}

        <ChartCard title="O que já está comprometido" subtitle="Por mês, a partir de agora" legend={[{ label: "Fixos e assinaturas", color: "var(--primary)" }, { label: "Parcelas", color: "var(--expense)" }]}>
          <div className="h-56 w-full" data-testid="commitments-bars">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.months.map((m) => ({ ...m, label: monthShort(m.month) }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                <YAxis hide={hidden} width={44} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={axisMoney} />
                <Tooltip active defaultIndex={pinIndex(data.months, (m) => m.month === month)} contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} cursor={{ fill: "var(--muted)" }} formatter={(v: number, name: string) => [money(v), name === "fixed" ? "Fixos e assinaturas" : "Parcelas"]} />
                {/* Stacked with a 2px surface gap between segments. */}
                <Bar dataKey="fixed" stackId="c" fill="var(--primary)" stroke="var(--card)" strokeWidth={2} maxBarSize={32} />
                <Bar dataKey="installments" stackId="c" fill="var(--expense)" stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Fixos e assinaturas" subtitle="Valor por mês">
            {data.fixedItems.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nenhum gasto fixo marcado. Marque lançamentos como fixos ou cadastre assinaturas.</p> : (
              <ul className="divide-y divide-border" data-testid="commitments-fixed">
                {data.fixedItems.slice(0, 10).map((item) => (
                  <li key={`${item.kind}-${item.name}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0"><span className="block truncate font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{item.kind === "assinatura" ? "Assinatura" : "Gasto fixo"}</span></span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(item.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
          <InstallmentsInsight />
        </div>
      </>}
    </div>
  );
}
