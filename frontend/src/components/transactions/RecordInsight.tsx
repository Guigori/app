import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { ChartNoAxesCombined, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { deleteTransaction, fetchTransactionHistory, fetchBudget, fetchBudgetCycleProgress, fetchCalendar, fetchCurrentBudgetCycle, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { addMonth, formatBRL, formatHiddenBRL } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { budgetImpact, cashFlowLink, cycleImpact, monthImpact, rhythm, signedAmount } from "@/lib/transactionInsight";
import { HistorySheet } from "@/components/transactions/HistorySheet";
import { DiscardRegisterDialog } from "@/components/layout/DiscardRegisterDialog";
import type { Transaction } from "@/types/finnos";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
const ordinal = (n: number) => `${n}ª`;

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
export function RecordInsight({ tx, onDeleted, onLeave }: { tx: Transaction; onDeleted: () => void; /** Leaving for another screen (the Caixa). */ onLeave: () => void }) {
  const { hidden } = useBalanceHidden();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const statusLabel = tx.status === "pago" ? (tx.type === "receita" ? "Recebido" : "Pago") : tx.status === "pendente" ? "Pendente" : tx.status;

  const impactRows: [string, string, string | undefined][] = [
    tx.type === "transferencia"
      ? [`Sai de ${tx.account_name}`, `−${money(tx.value)}`, "#fb7185"]
      : [`Saldo ${tx.card_name ? `da fatura ${tx.card_name}` : `da conta ${tx.account_name}`}`, `${signed < 0 ? "−" : "+"}${money(Math.abs(signed))}`, signed < 0 ? "#fb7185" : "#34d399"],
    ...(tx.type === "transferencia" && tx.to_account_name ? [[`Entra em ${tx.to_account_name}`, `+${money(tx.value)}`, "#34d399"] as [string, string, string]] : []),
    ...(impact ? [[`Orçamento de ${impact.name}`, `+${Math.max(1, Math.round(impact.share * 100))}% do limite`, impact.used > 1 ? "#fb7185" : undefined] as [string, string, string | undefined]] : []),
    ...(tx.category_name && tx.type !== "transferencia" ? [[`${tx.type === "receita" ? "Recebido" : "Gasto"} em ${tx.category_name} no mês`, `${ordinal(position)} ${tx.type === "receita" ? "entrada" : "compra"}`, undefined] as [string, string, undefined]] : []),
    ...(month_ ? [["Mês fecha em", money(month_.closes), month_.closes < 0 ? "#fb7185" : undefined] as [string, string, string | undefined]] : []),
  ];

  const remove = async () => {
    try {
      await deleteTransaction(tx.id);
      await Promise.all(["transactions", "accounts", "dashboard", "cards", "categories", "flow", "calendar", "budget"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success("Lançamento excluído.");
      onDeleted();
    } catch { toast.error("Não foi possível excluir agora."); }
  };

  let i = 0;
  return (
    <div className="flex flex-col gap-2.5 pb-2" data-testid="record-insight">
      <Card title="IMPACTO">
        {impactRows.map(([l, v, t], k) => <Row key={l} label={l} value={v} tone={t} i={k} last={k === impactRows.length - 1} />)}
        {impact ? (
          <div className="pb-1 pt-1" data-testid="transaction-detail-budget">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(impact.used * 100))}%`, backgroundColor: impact.used > 1 ? "#fb7185" : impact.used > 0.8 ? "#fbbf24" : "#34d399" }} /></div>
            <p className="mt-1.5 text-xs text-muted-foreground">{money(impact.spent)} de {money(impact.budget)} {fromCycle ? "no ciclo" : "no mês"} · {impact.remaining >= 0 ? `restam ${money(impact.remaining)}` : `passou ${money(-impact.remaining)}`}</p>
          </div>
        ) : null}
      </Card>
      <p className="flex shrink-0 items-center justify-center gap-1.5 text-xs text-muted-foreground"><ChevronDown size={14} aria-hidden="true" />Role para ver o comprovante completo</p>
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
      {same.length > 0 && tx.type !== "transferencia" ? (
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
          <span className="flex items-center gap-1 font-semibold">{historyQuery.isPending ? "…" : historyQuery.data?.length ?? 0}<ChevronRight size={15} className="text-[#a78bfa]" aria-hidden="true" /></span>
        </button>
      </Card>
      <HistorySheet open={historyOpen} events={historyQuery.data ?? []} onClose={() => setHistoryOpen(false)} />
      {enabled ? <Link to={cashFlowLink(tx)} onClick={onLeave} data-testid="transaction-detail-cashflow" className="flex h-[46px] shrink-0 items-center justify-between rounded-full border border-border bg-card px-5 text-[15px] font-semibold">
        <span className="flex items-center gap-2"><ChartNoAxesCombined size={17} className="text-[#a78bfa]" aria-hidden="true" />Ver no Caixa</span><ChevronRight size={17} className="text-muted-foreground" aria-hidden="true" />
      </Link> : null}
      <button type="button" onClick={() => setConfirmDelete(true)} data-testid="record-delete"
        className="flex h-[46px] shrink-0 items-center justify-center gap-2 rounded-full border border-[#5b1a2e] text-[15px] font-bold text-expense dark:text-[#fb7185]">
        <Trash2 size={17} aria-hidden="true" />Excluir lançamento
      </button>
      <DiscardRegisterDialog open={confirmDelete} kind="Despesa" title="Excluir este lançamento?" text="Ele sai do saldo, do orçamento e dos relatórios. Não dá para desfazer." keepLabel="Manter" discardLabel="Excluir lançamento"
        onKeep={() => setConfirmDelete(false)} onDiscard={() => { setConfirmDelete(false); void remove(); }} />
    </div>
  );
}
