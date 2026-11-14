import { useQuery } from "@tanstack/react-query";
import { Lightbulb, MessageCircleMore, X } from "lucide-react";
import {
  fetchBudget, fetchBudgetCycleProgress, fetchCalendar, fetchCurrentBudgetCycle, fetchSubscriptions, fetchTransaction, fetchTransactions,
} from "@/lib/data";
import { addMonth, formatBRL, formatDate, formatHiddenBRL, monthLabel, todayISO } from "@/lib/format";
import { focusFacts, signedAmount } from "@/lib/transactionInsight";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/types/finnos";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A lançamento read against its whole month in Caixa: weight, the month with and without it, rhythm, budget and ideas. */
export function FocusedTransaction({ id, monthRows, hidden, onClose }: { id: string; monthRows: Transaction[]; hidden: boolean; onClose: () => void }) {
  const dialogs = useDialogs();
  const txQuery = useQuery({ queryKey: ["transaction", id], queryFn: () => fetchTransaction(id) });
  const tx = txQuery.data;
  const month = tx?.date.slice(0, 7) ?? "";
  const ready = Boolean(tx);
  const spends = tx?.type === "despesa";
  const history = useQuery({
    queryKey: ["transactions", "insight", tx?.name, month],
    queryFn: () => fetchTransactions({ search: tx!.name.slice(0, 80), start_date: `${addMonth(month, -5)}-01`, end_date: `${month}-31` }),
    enabled: ready,
  });
  const calendar = useQuery({ queryKey: ["calendar", month, "todas"], queryFn: () => fetchCalendar(month), enabled: ready });
  const subscriptions = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions, enabled: ready });
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month), enabled: ready && spends });
  const cycle = useQuery({ queryKey: ["budget-v2-current"], queryFn: fetchCurrentBudgetCycle, enabled: ready && spends });
  const progress = useQuery({ queryKey: ["budget-v2-progress", cycle.data?.id], queryFn: () => fetchBudgetCycleProgress(cycle.data!.id), enabled: Boolean(cycle.data?.id) });

  if (txQuery.isPending) return <div className="h-40 animate-pulse rounded-2xl bg-muted" />;
  if (!tx) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="focus-missing">
        Este lançamento não existe mais.
        <button type="button" onClick={onClose} className="font-semibold text-primary">Ver o mês todo</button>
      </div>
    );
  }

  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const f = focusFacts(tx, {
    today: todayISO(), monthRows, history: history.data ?? [], subscriptions: subscriptions.data?.items ?? [],
    calendar: calendar.data, budget: budget.data, cycle: progress.data,
  });
  const income = tx.type === "receita";
  const tone = income ? "text-income" : tx.type === "despesa" ? "text-expense" : "text-transfer";
  const peak = f.impact ? Math.max(Math.abs(f.impact.closes), Math.abs(f.impact.without), 1) : 1;
  const ideas = [
    f.tenPercentYear ? `Gastando 10% menos com ${tx.name}, você libera ${money(f.tenPercentYear)} por ano.` : null,
    spends && f.share >= 0.3 && f.rhythm.kind === "unica" ? `Sozinho, ele é ${pct(f.share)} das saídas do mês: vale conferir se precisa se repetir.` : null,
    f.budget && f.budget.remaining < 0 ? `Com ele, ${f.budget.name} passou ${money(-f.budget.remaining)} do limite.` : null,
    f.vsAverage !== null && f.vsAverage >= 20 ? `Este mês está ${f.vsAverage}% acima da sua média com ${tx.name}.` : null,
  ].filter((idea): idea is string => Boolean(idea));

  return (
    <section className="rounded-2xl border border-primary/25 bg-card p-4 sm:p-5" data-testid="focus-card" aria-label={`Em foco: ${tx.name}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-3 pr-1 text-sm font-semibold text-primary">
          <span className="truncate">Em foco: {tx.name}</span>
          <button type="button" onClick={onClose} className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-primary/15" aria-label="Tirar o foco" data-testid="focus-close"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </span>
        <button type="button" onClick={() => dialogs.openTransactionDetail(tx)} className={cn("shrink-0 font-heading text-lg font-bold tabular-nums", tone)} data-testid="focus-value">
          {hidden ? formatHiddenBRL() : formatBRL(tx.type === "transferencia" ? tx.value : signedAmount(tx))}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{formatDate(tx.date)} · {tx.category_name ?? "Sem categoria"} · {tx.card_name ?? tx.account_name}</p>

      {tx.type !== "transferencia" ? (
        <div className="mt-4 grid grid-cols-3 gap-2" data-testid="focus-weight">
          <div className="rounded-xl bg-muted/60 p-2.5"><p className="text-[11px] text-muted-foreground">{income ? "Das entradas" : "Das saídas"}</p><p className="font-heading text-base font-bold tabular-nums">{pct(f.share)}</p></div>
          <div className="rounded-xl bg-muted/60 p-2.5"><p className="text-[11px] text-muted-foreground">Da renda</p><p className="font-heading text-base font-bold tabular-nums">{f.ofIncome !== null ? pct(f.ofIncome) : "—"}</p></div>
          <div className="rounded-xl bg-muted/60 p-2.5"><p className="text-[11px] text-muted-foreground">No mês</p><p className="font-heading text-base font-bold">{f.rank}º maior</p><p className="text-[11px] text-muted-foreground">de {f.count}</p></div>
        </div>
      ) : <p className="mt-3 text-sm text-muted-foreground">Movimento entre suas contas: muda onde o dinheiro está, não o seu saldo total.</p>}

      {f.impact ? (
        <div className="mt-4" data-testid="focus-impact">
          <p className="text-xs font-medium text-muted-foreground">Como {monthLabel(month)} fecha</p>
          <div className="mt-2 flex h-20 items-end gap-3" aria-hidden="true">
            {[{ label: "Com ele", value: f.impact.closes, strong: true }, { label: "Sem ele", value: f.impact.without, strong: false }].map((bar) => (
              <div key={bar.label} className="flex flex-1 flex-col items-center justify-end">
                <div className={cn("w-full rounded-t-lg", bar.value < 0 ? "bg-expense/70" : bar.strong ? "bg-primary" : "bg-primary/25")} style={{ height: `${Math.max(6, (Math.abs(bar.value) / peak) * 72)}px` }} />
              </div>
            ))}
          </div>
          <p className="mt-1.5 flex justify-between text-xs tabular-nums"><span>Com ele: <strong>{money(f.impact.closes)}</strong></span><span className="text-muted-foreground">Sem ele: {money(f.impact.without)}</span></p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 text-sm">
        {f.remaining ? (
          <div className="rounded-xl bg-muted/60 p-3" data-testid="focus-rhythm"><p className="text-xs text-muted-foreground">Parcelas</p><p className="mt-0.5">Faltam <strong className="tabular-nums">{money(f.remaining.total)}</strong>; a última cai em {monthLabel(f.remaining.lastMonth)}.</p></div>
        ) : f.yearly !== null ? (
          <div className="rounded-xl bg-muted/60 p-3" data-testid="focus-rhythm"><p className="text-xs text-muted-foreground">{f.rhythm.kind === "fixa" ? "Por ser fixa" : f.rhythm.kind === "assinatura" ? "Por ser assinatura" : "Por se repetir"}</p><p className="mt-0.5"><strong className="tabular-nums">{money(f.yearly)}</strong> por ano · próximos 6 meses: {money(f.nextSixMonths ?? 0)}</p></div>
        ) : null}
        {f.budget ? (
          <div className="rounded-xl bg-muted/60 p-3" data-testid="focus-budget"><p className="text-xs text-muted-foreground">Orçamento de {f.budget.name}</p><p className="mt-0.5">{f.budget.remaining >= 0 ? <>Depois dele restam <strong className="tabular-nums">{money(f.budget.remaining)}</strong>{f.perDay ? ` · ${money(f.perDay)} por dia` : ""}</> : <>Passou <strong className="tabular-nums text-expense">{money(-f.budget.remaining)}</strong> do limite</>}</p></div>
        ) : null}
        {f.average !== null ? (
          <div className="rounded-xl bg-muted/60 p-3" data-testid="focus-average"><p className="text-xs text-muted-foreground">Comparado com os meses anteriores</p><p className="mt-0.5">Média de <strong className="tabular-nums">{money(f.average)}</strong> por mês · este mês {f.vsAverage !== null && f.vsAverage >= 0 ? "+" : ""}{f.vsAverage ?? 0}%</p></div>
        ) : null}
      </div>

      {ideas.length ? (
        <ul className="mt-3 space-y-1.5" data-testid="focus-ideas">
          {ideas.map((idea) => <li key={idea} className="flex gap-2 text-xs leading-relaxed"><Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />{idea}</li>)}
        </ul>
      ) : null}

      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("finnos-ai-open", { detail: { question: `Evolução de ${tx.name} por mês` } }))} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary" data-testid="focus-ask-ai">
        <MessageCircleMore className="h-4 w-4" aria-hidden="true" />Perguntar na Conversa sobre {tx.name}
      </button>
    </section>
  );
}
