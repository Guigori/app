import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { ChartNoAxesCombined, CheckCircle2, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { createTransaction, deleteTransaction, fetchTransactionHistory, transactionInput, fetchBudget, fetchBudgetCycleProgress, fetchCalendar, fetchCurrentBudgetCycle, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { addMonth, formatBRL, formatHiddenBRL, monthLabel, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { budgetImpact, cashFlowLink, cycleImpact, monthImpact, monthlyHistory, rhythm, signedAmount } from "@/lib/transactionInsight";
import { HistorySheet } from "@/components/transactions/HistorySheet";
import { DiscardRegisterDialog } from "@/components/layout/DiscardRegisterDialog";
import type { Transaction } from "@/types/finnos";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="shrink-0 rounded-[20px] border border-border/70 bg-card px-4 pb-2">
      <h3 className="pb-0.5 pt-2.5 text-xs font-semibold tracking-[1.5px] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** One line of the receipt: fades and rises as it scrolls into view, one after another. */
function Row({ label, value, tone, i, last }: { label: string; value: ReactNode; tone?: string; i: number; last?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={"flex min-h-[38px] items-center justify-between gap-4 text-sm " + (last ? "" : "border-b border-dashed border-border")}
      initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.6 }} transition={{ delay: (i % 6) * 0.07, duration: 0.32, ease: "easeOut" }}>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold" style={tone ? { color: tone } : undefined}>{value}</span>
    </motion.div>
  );
}

/** A saved lançamento, under the register's fields: what it changed, then the full receipt as it scrolls. */
const HINT_KEY = "finnos:record-scroll-hint";
const shortDate = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

export function RecordInsight({ tx, onDeleted, onLeave, onSettle, settling }: { tx: Transaction; onDeleted: () => void; /** Leaving for another screen (the Caixa). */ onLeave: () => void; /** Marks it paid (or received) now. */ onSettle?: () => void; settling?: boolean }) {
  const { hidden } = useBalanceHidden();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // "Role para ver o comprovante" only for the first few openings.
  const [showHint] = useState(() => { try { const n = Number(localStorage.getItem(HINT_KEY) || 0); localStorage.setItem(HINT_KEY, String(n + 1)); return n < 3; } catch { return true; } });
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const month = tx.date.slice(0, 7);
  const enabled = !tx.id.startsWith("offline:");
  const spends = enabled && tx.type === "despesa";
  const historyQuery = useQuery({ queryKey: ["transaction-history", tx.id, tx.version], queryFn: () => fetchTransactionHistory(tx.id), enabled, retry: 1 });
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month), enabled: spends });
  const cycle = useQuery({ queryKey: ["budget-v2-current"], queryFn: fetchCurrentBudgetCycle, enabled: spends });
  const cycleProgress = useQuery({ queryKey: ["budget-v2-progress", cycle.data?.id], queryFn: () => fetchBudgetCycleProgress(cycle.data!.id), enabled: spends && Boolean(cycle.data?.id) });
  const calendar = useQuery({ queryKey: ["calendar", month, "todas"], queryFn: () => fetchCalendar(month), enabled });
  const history = useQuery({
    queryKey: ["transactions", "insight", tx.name, month],
    queryFn: () => fetchTransactions({ search: tx.name.slice(0, 80), start_date: `${addMonth(month, -5)}-01`, end_date: `${month}-31` }),
    enabled,
  });
  const subscriptions = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions, enabled });

  const fromCycle = cycleImpact(tx, cycleProgress.data);
  // Older lançamentos (imported, restored, or created before the history existed) still show when they were made.
  const events = historyQuery.data?.length ? historyQuery.data : historyQuery.isSuccess || historyQuery.isError
    ? [{ id: "created", action: "created" as const, created_at: tx.created_at, before: null, after: { name: tx.name, value_cents: Math.round(tx.value * 100), date: tx.date } }] : [];
  const impact = fromCycle ?? budgetImpact(tx, budget.data);
  const month_ = monthImpact(tx, calendar.data);
  const same = (history.data ?? []).filter((r) => r.type === tx.type && norm(r.name) === norm(tx.name) && r.date.slice(0, 7) === month);
  const position = same.filter((r) => r.date < tx.date || (r.date === tx.date && r.created_at <= tx.created_at)).length || 1;
  const total = same.reduce((s, r) => s + r.value, 0);
  const repeats = rhythm(tx, history.data ?? [], subscriptions.data?.items ?? []);
  const signed = signedAmount(tx);
  const created = tx.created_at ? new Date(tx.created_at) : null;
  const when = created && !Number.isNaN(created.getTime()) ? `${created.toLocaleDateString("pt-BR")} · ${created.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : tx.date.split("-").reverse().join("/");
  const origin = tx.origin || (tx.capture ? "Apple Pay" : "Registro manual");
  const statusLabel = tx.status === "pago" ? (tx.type === "receita" ? "Recebido" : "Pago") : tx.status === "pendente" ? "Pendente" : tx.status === "agendado" ? "Agendado" : tx.status;

  const done = tx.status === "pago";
  const where = tx.card_name ? `da fatura ${tx.card_name}` : tx.account_name;
  // Paid money already moved; scheduled or pending money will move on its date.
  const moneyLine: [string, string, string | undefined] = tx.type === "transferencia"
    ? [done ? `Saiu de ${tx.account_name}` : `Vai sair de ${tx.account_name} em ${shortDate(tx.date)}`, `−${money(tx.value)}`, "#fb7185"]
    : tx.type === "receita"
      ? [done ? `Entrou em ${tx.account_name}` : `Vai entrar em ${tx.account_name} em ${shortDate(tx.date)}`, `+${money(tx.value)}`, "#34d399"]
      : [tx.card_name ? `Na fatura ${tx.card_name}` : done ? `Saiu do ${where}` : `Vai sair do ${where} em ${shortDate(tx.date)}`, `−${money(Math.abs(signed))}`, "#fb7185"];
  const over = impact && impact.remaining < 0;
  const impactRows: [string, string, string | undefined][] = [
    moneyLine,
    ...(tx.type === "transferencia" && tx.to_account_name ? [[done ? `Entrou em ${tx.to_account_name}` : `Vai entrar em ${tx.to_account_name}`, `+${money(tx.value)}`, "#34d399"] as [string, string, string]] : []),
    ...(impact ? [over
      ? [`Orçamento de ${impact.name}`, `passou ${money(-impact.remaining)}`, "#fb7185"] as [string, string, string]
      : [`Orçamento de ${impact.name}`, `+${Math.max(1, Math.round(impact.share * 100))}% do limite`, impact.used > 0.8 ? "#fbbf24" : undefined] as [string, string, string | undefined]] : []),
    ...(tx.category_name && tx.type !== "transferencia" ? [[`${tx.category_name} no mês`, `${position}º lançamento`, undefined] as [string, string, undefined]] : []),
    ...(month_ ? [[done ? "Mês fecha em" : "Mês deve fechar em", money(month_.closes), month_.closes < 0 ? "#fb7185" : undefined] as [string, string, string | undefined]] : []),
  ];
  // The same name in the previous months: is this one higher or lower than usual?
  const months = Array.from({ length: 6 }, (_, i) => addMonth(month, i - 5));
  const bars = monthlyHistory(tx, history.data ?? [], months);
  const previous = bars.slice(0, -1).filter((b) => b.total > 0);
  const recent = previous.slice(-3);
  const average = recent.length ? recent.reduce((t, b) => t + b.total, 0) / recent.length : 0;
  const thisMonth = bars[bars.length - 1]?.total || tx.value;
  const change = average > 0 ? (thisMonth - average) / average : 0;
  const peak = Math.max(...bars.map((b) => b.total), tx.value, 1);

  const refresh = () => Promise.all(["transactions", "accounts", "dashboard", "cards", "categories", "flow", "calendar", "budget"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  // A plain lançamento goes at once with "Desfazer"; series, installments and invoice entries ask first.
  const simple = !tx.fixed && !tx.installment && !tx.invoice_payment && !tx.invoice_refund && !tx.recurrence_id;
  const remove = async () => {
    try {
      await deleteTransaction(tx.id);
      await refresh();
      onDeleted();
      if (simple) {
        toast("Lançamento excluído.", { duration: 6000, action: { label: "Desfazer", onClick: () => { void createTransaction(transactionInput(tx), "manual").then(() => { void refresh(); toast.success("Lançamento restaurado."); }).catch(() => toast.error("Não foi possível restaurar.")); } } });
      } else toast.success("Lançamento excluído.");
    } catch { toast.error("Não foi possível excluir agora."); }
  };

  let i = 0;
  return (
    <div className="flex flex-col gap-2.5 pb-2" data-testid="record-insight">
      {!done && onSettle ? (
        <motion.button type="button" onClick={onSettle} disabled={settling} data-testid="record-settle" whileTap={{ scale: 0.97 }}
          className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-[#047857] text-[15px] font-bold text-white shadow-[0_6px_20px_rgba(4,120,87,.3)] disabled:opacity-60">
          <CheckCircle2 size={18} aria-hidden="true" />{settling ? "Salvando…" : tx.type === "receita" ? "Marcar como recebido" : `Marcar como pago${tx.date > todayISO() ? " hoje" : ""}`}
        </motion.button>
      ) : null}
      <Card title="IMPACTO">
        {impactRows.map(([l, v, t], k) => <Row key={l} label={l} value={v} tone={t} i={k} last={k === impactRows.length - 1} />)}
        {impact ? (
          <div className="pb-1 pt-1" data-testid="transaction-detail-budget">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(impact.used * 100))}%`, backgroundColor: impact.used > 1 ? "#fb7185" : impact.used > 0.8 ? "#fbbf24" : "#34d399" }} /></div>
            <p className={"mt-1.5 text-xs " + (over ? "font-semibold text-expense dark:text-[#fb7185]" : "text-muted-foreground")}>{money(impact.spent)} de {money(impact.budget)} {fromCycle ? "no ciclo" : "no mês"}{over ? " · orçamento estourado" : ` · restam ${money(impact.remaining)}`}</p>
          </div>
        ) : null}
      </Card>
      {previous.length ? (
        <Card title="NOS ÚLTIMOS MESES">
          <div className="flex h-16 items-end gap-1.5 pt-2" aria-hidden="true">
            {bars.map((b, k) => (
              <div key={b.month} className="flex flex-1 flex-col items-center gap-1">
                <motion.div className="w-full rounded-md" style={{ backgroundColor: k === bars.length - 1 ? (tx.type === "receita" ? "#34d399" : "#fb7185") : "#2f3060" }}
                  initial={{ height: 0 }} whileInView={{ height: `${Math.max(4, (b.total / peak) * 44)}px` }} viewport={{ once: true }} transition={{ delay: k * 0.05, duration: 0.4 }} />
                <span className="text-[10px] text-muted-foreground">{monthLabel(b.month).slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <p className="py-2 text-sm" data-testid="record-trend">
            {average <= 0 ? "Primeira vez nos últimos meses." : Math.abs(change) < 0.05
              ? <>Parecido com a média de {money(average)}.</>
              : <><span className="font-semibold" style={{ color: (change > 0) === (tx.type !== "receita") ? "#fb7185" : "#34d399" }}>{Math.round(Math.abs(change) * 100)}% {change > 0 ? "acima" : "abaixo"}</span> da média dos últimos {recent.length === 1 ? "mês" : `${recent.length} meses`} ({money(average)}).</>}
          </p>
        </Card>
      ) : null}
      {showHint ? <p className="flex shrink-0 items-center justify-center gap-1.5 text-xs text-muted-foreground"><ChevronDown size={14} aria-hidden="true" />Role para ver o comprovante completo</p> : null}
      <Card title="COMPROVANTE">
        <div data-testid="transaction-detail-receipt">
          <Row label="Quando" value={when} i={i++} />
          <Row label={tx.type === "transferencia" ? "Sai de" : "Como pagou"} value={tx.card_name ? `Crédito · ${tx.card_name}` : tx.account_name} i={i++} />
          {tx.type === "transferencia" && tx.to_account_name ? <Row label="Vai para" value={tx.to_account_name} i={i++} /> : null}
          <Row label="Origem" value={origin} tone="#c4b5fd" i={i++} />
          {tx.category_name ? <Row label="Categoria" value={tx.category_name} tone={tx.category_color ?? undefined} i={i++} /> : null}
          {tx.notes ? <Row label="Nota" value={tx.notes} i={i++} /> : null}
          <Row label="Status" value={statusLabel} tone={tx.status === "pago" ? "#34d399" : "#fbbf24"} i={i++} last />
        </div>
      </Card>
      {same.length >= 2 && tx.type !== "transferencia" ? (
        <Card title={tx.type === "receita" ? "SOBRE ESTA ORIGEM" : "SOBRE ESTE ESTABELECIMENTO"}>
          <Row label={tx.type === "receita" ? "Entradas neste mês" : "Compras neste mês"} value={String(same.length)} i={0} />
          <Row label="Média por vez" value={money(total / same.length)} i={1} />
          <Row label="Total no mês" value={money(total)} i={2} last />
        </Card>
      ) : null}
      <Card title="DETALHES">
        <Row label={tx.type === "receita" ? "Receita fixa" : "Despesa fixa"} value={tx.fixed ? "Sim" : "Não"} i={0} />
        <Row label="Parcelado" value={tx.installment && tx.total_installments ? `${tx.current_installment ?? 1} de ${tx.total_installments}` : "Não"} i={1} />
        <Row label="Repetição" value={repeats.kind === "unica" ? "Avulso" : repeats.kind === "repete" ? `${repeats.times}× em 6 meses` : repeats.kind === "assinatura" ? "Assinatura" : repeats.kind === "fixa" ? "Fixa" : "Avulso"} i={2} />
        <button type="button" onClick={() => setHistoryOpen(true)} data-testid="record-history-open" className="flex min-h-[38px] w-full items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Histórico de alterações</span>
          <span className="flex items-center gap-1 font-semibold">{historyQuery.isPending ? "…" : events.length}<ChevronRight size={15} className="text-[#a78bfa]" aria-hidden="true" /></span>
        </button>
      </Card>
      <HistorySheet open={historyOpen} events={events} onClose={() => setHistoryOpen(false)} />
      {enabled ? <Link to={cashFlowLink(tx)} onClick={onLeave} data-testid="transaction-detail-cashflow" className="flex h-[46px] shrink-0 items-center justify-between rounded-full border border-border bg-card px-5 text-[15px] font-semibold">
        <span className="flex items-center gap-2"><ChartNoAxesCombined size={17} className="text-[#a78bfa]" aria-hidden="true" />Ver no Caixa</span><ChevronRight size={17} className="text-muted-foreground" aria-hidden="true" />
      </Link> : null}
      <button type="button" onClick={() => (simple ? void remove() : setConfirmDelete(true))} data-testid="record-delete"
        className="flex h-[46px] shrink-0 items-center justify-center gap-2 rounded-full border border-[#5b1a2e] text-[15px] font-bold text-expense dark:text-[#fb7185]">
        <Trash2 size={17} aria-hidden="true" />Excluir lançamento
      </button>
      <DiscardRegisterDialog open={confirmDelete} kind="Despesa" title="Excluir este lançamento?" text="Ele sai do saldo, do orçamento e dos relatórios. Não dá para desfazer." keepLabel="Manter" discardLabel="Excluir lançamento"
        onKeep={() => setConfirmDelete(false)} onDiscard={() => { setConfirmDelete(false); void remove(); }} />
    </div>
  );
}
