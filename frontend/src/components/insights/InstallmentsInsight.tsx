import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ChevronDown, Layers } from "lucide-react";
import { fetchBudget, fetchCards, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { currentMonth, formatBRL, formatHiddenBRL } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { commitments } from "@/lib/analysisInsights";
import { budgetPressure, installmentPlans, installmentSchedule, summarizeInstallments } from "@/lib/insights/installments";
import { cn } from "@/lib/utils";
import { InsightShell, NOTE, NUMBER_TILE, Tile } from "@/components/insights/InsightShell";
import { Bars, BulletBar } from "@/components/charts/FinnosCharts";
import type { WidgetSize } from "@/lib/insights/registry";

const SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const short = (month: string) => SHORT[Number(month.slice(5, 7)) - 1] ?? month;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Analysis library · Parcelas em andamento: where each one is, what is left, the next months and their weight on the budget. */
export function InstallmentsInsight({ cardId = null, compact = false, size, to, className }: { cardId?: string | null; compact?: boolean; size?: WidgetSize; to?: string; className?: string }) {
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const [opened, setOpen] = useState(false);
  // The analysis page shows everything; Grande shows the first three.
  const open = opened || size === "XL";
  const month = currentMonth();
  // Same query as Análise → Compromissos, so both read one cache.
  const transactions = useQuery({ queryKey: ["transactions", "analysis-all"], queryFn: () => fetchTransactions({ start_date: "1900-01-01", end_date: "2999-12-31" }), staleTime: 60_000 });
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month), staleTime: 60_000, enabled: open });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards, staleTime: 60_000 });
  const subscriptions = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions, staleTime: 60_000, enabled: open });

  if (transactions.isPending || cards.isPending) return <div className={cn("h-40 animate-pulse rounded-[24px] bg-muted", className)} aria-label="Carregando parcelas" />;
  const cardName = new Map((cards.data ?? []).map((c) => [c.id, c.name]));
  // Card installments follow each card's invoices (closing day), like the Faturas analysis.
  const rules = new Map((cards.data ?? []).map((c) => [c.id, { closing_day: c.closing_day, next_closing: c.next_closing }]));
  const plans = installmentPlans(transactions.data ?? [], month, cardId, rules).map((p) => ({ ...p, where: (p.cardId && cardName.get(p.cardId)) || p.where }));
  const summary = summarizeInstallments(plans, month);
  if (!plans.length && compact) return null;
  if (size === "S" || size === "M") {
    const top = plans.filter((p) => p.current > 0).slice(0, 2);
    return (
      <Tile title="Parcelas" icon={<Layers className="size-3.5" />} className={className} testId="installments-insight">
        <div className="flex items-baseline justify-between gap-3"><p className={NUMBER_TILE}>{money(summary.monthly)}</p>{size === "M" ? <span className={cn(NOTE, "shrink-0")}>faltam {money(summary.remaining)}</span> : null}</div>
        {size === "S" ? <p className={cn(NOTE, "mt-auto line-clamp-2")}>por mês · faltam {money(summary.remaining)}</p> : (
          <ul className="mt-auto space-y-2">
            {top.map((p) => (
              <li key={p.id} className="text-xs">
                <div className="flex justify-between gap-2"><span className="min-w-0 truncate">{p.name}</span><span className="shrink-0 text-muted-foreground">{p.current} de {p.count}</span></div>
                <div className="mt-1 flex gap-0.5">{Array.from({ length: Math.min(p.count, 24) }, (_, i) => <span key={i} className={cn("h-1 flex-1 rounded-full", i < p.current ? "bg-primary" : "bg-muted")} />)}</div>
              </li>
            ))}
            {!top.length ? <li className="text-xs text-muted-foreground">Nenhuma parcela neste mês.</li> : null}
          </ul>
        )}
      </Tile>
    );
  }
  const schedule = installmentSchedule(plans, month, 6);
  // The budget question looks at everything the month already owes: installments of every card plus fixed costs.
  const allPlans = cardId ? installmentPlans(transactions.data ?? [], month, null, rules) : plans;
  const fixedMonthly = open && transactions.data ? commitments(transactions.data, subscriptions.data?.items ?? [], month, 1).fixedMonthly : 0;
  const planned = budget.data?.planned ?? 0;
  const pressure = budgetPressure(installmentSchedule(allPlans, month, 6), planned, fixedMonthly).slice(1);
  const visible = open ? plans : plans.slice(0, 3);

  return (
    <InsightShell
      to={to}
      className={className}
      testId={cardId ? `installments-insight-${cardId}` : "installments-insight"}
      title="Parcelas em andamento"
      subtitle={plans.length ? <>{plans.length} {plans.length === 1 ? "compra parcelada" : "compras parceladas"} · <b className="text-foreground">{money(summary.monthly)}</b> por mês · ainda faltam <b className="text-foreground">{money(summary.remaining)}</b></> : "Nenhuma compra parcelada em andamento."}
    >
      {plans.length ? (
        <>
          <ul className="space-y-3" data-testid="installments-list">
            {visible.map((p) => (
              <li key={p.id}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{p.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{money(p.value)}<span className="text-xs font-normal text-muted-foreground">/mês</span></span>
                </div>
                <div className="mt-1.5 flex gap-0.5" aria-label={`Parcela ${p.current} de ${p.count}`}>
                  {Array.from({ length: Math.min(p.count, 24) }, (_, i) => (
                    <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < p.current - 1 ? "bg-primary" : i === p.current - 1 ? "bg-primary/70" : "bg-muted")} />
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.current ? `parcela ${p.current} de ${p.count}${p.cardId && rules.get(p.cardId) ? ` na fatura de ${short(rules.get(p.cardId)!.next_closing.slice(0, 7))}` : ""}` : `começa ${p.cardId ? "na fatura de" : "em"} ${short(p.startMonth)}`}{p.where ? ` · ${p.where}` : ""} · total {money(p.total)}
                  {p.left ? ` · faltam ${p.left} (${money(p.remaining)}) até ${p.cardId ? "a fatura de " : ""}${short(p.endMonth)}` : " · última parcela"}
                </p>
              </li>
            ))}
          </ul>

          {summary.freedNextMonth > 0 && size !== "L" ? (
            <p className="mt-3 rounded-2xl bg-income/10 px-3 py-2 text-sm text-income">A partir de {short(schedule[1]?.month ?? month)}, sobram {money(summary.freedNextMonth)} por mês: {summary.plans.filter((p) => p.endMonth === month && p.current > 0).map((p) => p.name).join(", ")} {summary.plans.filter((p) => p.endMonth === month && p.current > 0).length === 1 ? "termina" : "terminam"} agora.</p>
          ) : null}

          {open ? (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 space-y-5">
              <div data-testid="installments-schedule">
                <p className="text-xs font-semibold tracking-[1.5px] text-muted-foreground">PRÓXIMAS PARCELAS</p>
                <Bars className="mt-3" height={120} data={schedule.map((m, k) => ({ label: cap(short(m.month)), value: m.total, focus: k === 0, future: k > 0, valueLabel: hidden || !m.total ? "" : String(Math.round(m.total)) }))} />
                {schedule.some((m) => m.ending.length) ? <ul className="mt-2 space-y-0.5 text-xs text-income">{schedule.filter((m) => m.ending.length).map((m) => <li key={m.month}>{cap(short(m.month))}: termina {m.ending.join(", ")}</li>)}</ul> : null}
              </div>
              <div data-testid="installments-budget">
                <p className="text-xs font-semibold tracking-[1.5px] text-muted-foreground">NO ORÇAMENTO DOS PRÓXIMOS MESES</p>
                {planned > 0 ? (
                  <ul className="mt-2 space-y-2.5">
                    {pressure.map((m) => (
                      <li key={m.month} className="text-sm">
                        <div className="flex items-baseline justify-between gap-2"><span>{cap(short(m.month))}</span><span className={cn("font-semibold tabular-nums", (m.share ?? 0) > 1 ? "text-expense" : "text-foreground")}>{Math.round((m.share ?? 0) * 100)}% já comprometido</span></div>
                        <BulletBar className="mt-2" value={m.committed} limit={planned} />
                        <p className="mt-0.5 text-xs text-muted-foreground">{money(m.installments)} em parcelas{m.fixed > 0 ? ` + ${money(m.fixed)} fixos` : ""} · livre {money(Math.max(0, planned - m.committed))} de {money(planned)}</p>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-sm text-muted-foreground">{budget.isPending ? "Carregando orçamento…" : "Defina um orçamento para ver quanto dos próximos meses já está comprometido."}</p>}
              </div>
            </motion.div>
          ) : null}

          {size === "L" || size === "XL" ? null : <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary" data-testid="installments-more">
            {open ? "Ver menos" : plans.length > 3 ? `Ver todas (${plans.length}) e os próximos meses` : "Ver próximas parcelas e o orçamento"}
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>}
        </>
      ) : null}
    </InsightShell>
  );
}
