import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChartNoAxesCombined, ChevronRight, Pencil, Radar as RadarIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { fetchBudget, fetchBudgetCycleProgress, fetchCurrentBudgetCycle, fetchCalendar, fetchRadar, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { addMonth, formatBRL, formatDate, formatHiddenBRL, formatSignedBRL, monthLabel } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { budgetImpact, cashFlowLink, cycleImpact, flowPath, monthImpact, monthlyHistory, rhythm, signedAmount, type Rhythm } from "@/lib/transactionInsight";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { StatusBadge } from "@/components/shared/Badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/types/finnos";

const TYPE_LABEL = { despesa: "Despesa", receita: "Receita", transferencia: "Transferência" } as const;

/** The lançamento as a receipt: it unrolls from the top and lists every detail that was recorded. */
function Receipt({ tx }: { tx: Transaction }) {
  const reduce = useReducedMotion();
  const origin = tx.capture === "apple_pay_auto" ? "Apple Pay · automático" : tx.capture === "apple_pay" ? "Apple Pay · confirmado" : "Registro manual";
  const created = tx.created_at ? new Date(tx.created_at) : null;
  const rows: [string, string][] = [
    ["Tipo", TYPE_LABEL[tx.type]],
    [tx.type === "transferencia" ? "Sai de" : tx.card_name ? "Cartão" : "Conta", tx.card_name ?? tx.account_name],
    ...(tx.type === "transferencia" && tx.to_account_name ? [["Vai para", tx.to_account_name] as [string, string]] : []),
    ...(tx.category_name ? [["Categoria", tx.category_name] as [string, string]] : []),
    ["Data", formatDate(tx.date)],
    ["Origem", tx.origin ? `${tx.origin} · ${origin}` : origin],
    ...(tx.installment && tx.total_installments ? [["Parcela", `${tx.current_installment ?? 1} de ${tx.total_installments}`] as [string, string]] : []),
    ...(created && !Number.isNaN(created.getTime()) ? [["Registrado em", created.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })] as [string, string]] : []),
  ];
  return (
    <motion.section data-testid="transaction-detail-receipt" aria-label="Comprovante"
      className="overflow-hidden rounded-2xl border border-dashed border-border bg-card"
      initial={reduce ? false : { clipPath: "inset(0 0 100% 0)", opacity: 0.6 }} animate={{ clipPath: "inset(0 0 0% 0)", opacity: 1 }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
      <dl className="divide-y divide-dashed divide-border px-3.5">
        {rows.map(([label, value], i) => (
          <motion.div key={label} className="flex items-center justify-between gap-4 py-2.5 text-sm"
            initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.07, duration: 0.3 }}>
            <dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 truncate text-right font-medium">{value}</dd>
          </motion.div>
        ))}
      </dl>
    </motion.section>
  );
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

function rhythmText(r: Rhythm, money: (v: number) => string): string {
  switch (r.kind) {
    case "parcela": return r.left ? `Parcela ${r.current} de ${r.total} · faltam ${r.left}` : `Última parcela (${r.total} de ${r.total})`;
    case "fixa": return `Despesa fixa · se repete (${r.recurrence})`;
    case "assinatura": return `Assinatura cadastrada como ${r.name}`;
    case "repete": return `Apareceu ${r.times} vezes nos últimos 6 meses · média de ${money(r.average)}`;
    case "unica": return "Lançamento avulso, sem repetição recente";
  }
}

interface Props {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (transaction: Transaction) => void;
}

/** What a lançamento means: where it went, which budget it used, whether it repeats and how it moves the month. */
export function TransactionDetailSheet({ transaction: tx, open, onOpenChange, onEdit }: Props) {
  const { hidden } = useBalanceHidden();
  // Bottom sheet on the phone, side panel on wide screens.
  const [side] = useState<"bottom" | "right">(() => (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? "right" : "bottom"));
  const month = tx?.date.slice(0, 7) ?? "";
  const enabled = open && Boolean(tx) && !tx?.id.startsWith("offline:");
  const months = month ? Array.from({ length: 6 }, (_, i) => addMonth(month, i - 5)) : [];
  const spends = enabled && tx?.type === "despesa";
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month), enabled: spends });
  // The Orçamento screen works in cycles; when one covers this date its limit is the one that counts.
  const cycle = useQuery({ queryKey: ["budget-v2-current"], queryFn: fetchCurrentBudgetCycle, enabled: spends });
  const cycleProgress = useQuery({
    queryKey: ["budget-v2-progress", cycle.data?.id],
    queryFn: () => fetchBudgetCycleProgress(cycle.data!.id),
    enabled: spends && Boolean(cycle.data?.id),
  });
  const calendar = useQuery({ queryKey: ["calendar", month, "todas"], queryFn: () => fetchCalendar(month), enabled });
  const history = useQuery({
    queryKey: ["transactions", "insight", tx?.name, month],
    queryFn: () => fetchTransactions({ search: tx!.name.slice(0, 80), start_date: `${months[0]}-01`, end_date: `${month}-31` }),
    enabled,
  });
  const subscriptions = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions, enabled });
  const radar = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 60_000, enabled });

  if (!tx) return null;
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));
  const path = flowPath(tx);
  const fromCycle = cycleImpact(tx, cycleProgress.data);
  const impact = fromCycle ?? budgetImpact(tx, budget.data);
  // Once the cycle answers, the monthly limit is not waited for.
  const budgetPending = !fromCycle && (cycle.isPending || (Boolean(cycle.data?.id) && cycleProgress.isPending) || (budget.isPending && !budget.isError));
  const repeats = rhythm(tx, history.data ?? [], subscriptions.data?.items ?? []);
  const bars = monthlyHistory(tx, history.data ?? [], months);
  const peak = Math.max(...bars.map((b) => b.total), 0);
  const month_ = monthImpact(tx, calendar.data);
  const signal = radar.data?.items.find((s) => s.related_entity_type === "transaction" && s.related_entity_id === tx.id);
  const close = () => onOpenChange(false);
  const tone = tx.type === "receita" ? "text-income" : tx.type === "despesa" ? "text-expense" : "text-transfer";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={cn("gap-0 overflow-y-auto p-0", side === "bottom" ? "max-h-[90svh] rounded-t-3xl" : "w-full sm:max-w-md")} data-testid="transaction-detail">
        {side === "bottom" ? <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden="true" /> : null}
        <div className="space-y-4 p-5 pb-8">
          <header className="flex items-start gap-3 pl-12">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ backgroundColor: `color-mix(in oklab, ${tx.category_color ?? "#64748B"} 16%, transparent)`, color: tx.category_color ?? "#64748B" }}>
              <CategoryIcon name={tx.category_icon ?? "more-horizontal"} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <SheetTitle className="truncate font-heading text-lg font-bold">{tx.name}</SheetTitle>
              <SheetDescription className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                {formatDate(tx.date)} <StatusBadge status={tx.status} />
              </SheetDescription>
            </div>
          </header>
          <p className={cn("font-heading text-3xl font-bold tabular-nums", tone)} data-testid="transaction-detail-value">
            {hidden ? formatHiddenBRL() : tx.type === "transferencia" ? formatBRL(tx.value) : formatSignedBRL(signedAmount(tx))}
          </p>

          <Receipt tx={tx} />

          <section className="rounded-2xl bg-muted/60 p-3.5" data-testid="transaction-detail-path">
            <h3 className="text-xs font-medium text-muted-foreground">{tx.type === "receita" ? "De onde veio" : "De onde saiu e para onde foi"}</h3>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span>{path.from}</span><ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span>{path.to}</span>
            </p>
            {tx.account_id && !tx.id.startsWith("offline:") ? (
              <Link to={`/transacoes?aba=caixa&month=${month}&account_id=${encodeURIComponent(tx.account_id)}`} onClick={close} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary" data-testid="transaction-detail-account-flow">
                Caixa de {tx.account_name}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : null}
          </section>

          {tx.type === "despesa" && tx.category_id ? (
            <section className="rounded-2xl bg-muted/60 p-3.5" data-testid="transaction-detail-budget">
              <h3 className="text-xs font-medium text-muted-foreground">Orçamento de {tx.category_name ?? "categoria"} · {fromCycle && cycleProgress.data ? `ciclo ${formatDate(cycleProgress.data.start_date).slice(0, 5)} a ${formatDate(cycleProgress.data.end_date).slice(0, 5)}` : monthLabel(month)}</h3>
              {budgetPending ? <div className="mt-2 h-8 animate-pulse rounded-lg bg-muted" /> : impact ? (
                <>
                  <p className="mt-1.5 text-sm font-semibold tabular-nums">{money(impact.spent)} de {money(impact.budget)} · {pct(impact.used)}</p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-background" role="progressbar" aria-valuenow={Math.round(impact.used * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Uso do limite">
                    <div className={cn("h-full rounded-full", impact.status === "acima" ? "bg-expense" : impact.status === "proximo" ? "bg-amber-500" : "bg-income")} style={{ width: `${Math.min(100, impact.used * 100)}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {impact.counted ? "Contando este lançamento quando for pago. " : ""}Ele é {pct(impact.share)} do limite · {impact.remaining >= 0 ? `restam ${money(impact.remaining)}` : `passou ${money(-impact.remaining)} do limite`}
                  </p>
                </>
              ) : (
                <p className="mt-1.5 text-sm">Sem limite definido para esta categoria. <Link to="/orcamento/configuracoes" onClick={close} className="font-semibold text-primary">Definir limite</Link></p>
              )}
            </section>
          ) : null}

          <section className="rounded-2xl bg-muted/60 p-3.5" data-testid="transaction-detail-rhythm">
            <h3 className="text-xs font-medium text-muted-foreground">Recorrência</h3>
            <p className="mt-1.5 text-sm font-semibold">{history.isPending ? "Verificando…" : rhythmText(repeats, money)}</p>
            {repeats.kind !== "unica" && peak > 0 ? (
              <div className="mt-3 flex h-14 items-end gap-1.5" aria-label="Valor por mês nos últimos 6 meses">
                {bars.map((bar) => (
                  <div key={bar.month} className="flex flex-1 flex-col items-center gap-1" title={`${monthLabel(bar.month)}: ${money(bar.total)}`}>
                    <div className={cn("w-full rounded-t", bar.month === month ? "bg-primary" : "bg-primary/30")} style={{ height: `${Math.max(4, (bar.total / peak) * 40)}px` }} />
                    <span className="text-[10px] text-muted-foreground">{monthLabel(bar.month).slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {month_ ? (
            <section className="rounded-2xl bg-muted/60 p-3.5" data-testid="transaction-detail-impact">
              <h3 className="text-xs font-medium text-muted-foreground">Impacto em {monthLabel(month)}</h3>
              <p className="mt-1.5 text-sm">
                O mês fecha em <strong className="tabular-nums">{money(month_.closes)}</strong>.
                {" "}Sem este lançamento, fecharia em <strong className="tabular-nums">{money(month_.without)}</strong>.
              </p>
              {month_.ofIncome !== null ? <p className="mt-1 text-xs text-muted-foreground">Equivale a {pct(month_.ofIncome)} da renda do mês.</p> : null}
            </section>
          ) : null}

          {tx.type === "transferencia" ? (
            <p className="rounded-2xl bg-muted/60 p-3.5 text-sm" data-testid="transaction-detail-impact">Movimento entre suas contas: muda onde o dinheiro está, não o seu saldo total.</p>
          ) : null}

          {signal ? (
            <Link to={`/radar/${signal.id}`} onClick={close} className="flex items-center gap-3 rounded-2xl border border-border p-3.5 hover:bg-muted" data-testid="transaction-detail-radar">
              <RadarIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">O Radar notou</span><span className="block truncate text-sm font-semibold">{signal.title}</span></span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          ) : null}

          {tx.notes ? <p className="rounded-2xl border border-border p-3.5 text-sm text-muted-foreground">{tx.notes}</p> : null}

          <div className="grid gap-2 pt-1">
            <Link to={cashFlowLink(tx)} onClick={close} className={cn(buttonVariants(), "h-11 justify-between rounded-2xl")} data-testid="transaction-detail-cashflow">
              <span className="flex items-center gap-2"><ChartNoAxesCombined className="h-4 w-4" aria-hidden="true" />Ver no Caixa</span><ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Button variant="outline" className="h-11 justify-between rounded-2xl" onClick={() => { close(); onEdit(tx); }} data-testid="transaction-detail-edit">
              <span className="flex items-center gap-2"><Pencil className="h-4 w-4" aria-hidden="true" />Editar lançamento</span><ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
