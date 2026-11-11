import { useEffect, useRef, useState, type ReactNode } from "react";
import { categoryFlowPath } from "@/lib/categoryLinks";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarSync, Camera, ChartNoAxesCombined, CheckCircle2, ChevronDown, ChevronRight, Copy, Repeat, Share2, Trash2, TriangleAlert, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { listGoals } from "@/lib/goals";
import { toast } from "sonner";
import { addTransactionPhoto, fetchCards, fetchMe, createTransaction, deleteTransaction, fetchTransactionHistory, removeTransactionPhoto, transactionInput, updateTransaction, fetchBudget, fetchBudgetCycleProgress, fetchCalendar, fetchCurrentBudgetCycle, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { addMonth, formatBRL, formatHiddenBRL, monthLabel, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { budgetImpact, cashFlowLink, cycleImpact, monthImpact, monthlyHistory, rhythm, signedAmount } from "@/lib/transactionInsight";
import { ATTACHMENT_MARKER, fetchAttachment } from "@/lib/attachments";
import { receiptImage, shareImage } from "@/lib/receiptImage";
import { ChoiceSheet } from "@/components/shared/ChoiceSheet";
import { HistorySheet } from "@/components/transactions/HistorySheet";
import { DiscardRegisterDialog } from "@/components/layout/DiscardRegisterDialog";
import type { Transaction } from "@/types/finnos";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();

function Card({ title, children, label }: { title: string; children: ReactNode; /** Read aloud instead of the rows, as one sentence. */ label?: string }) {
  return (
    <section className="shrink-0 rounded-[20px] border border-border/70 bg-card px-4 pb-2" aria-label={label}>
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

/** A detail line that can be changed from here ("Tornar fixa", "Parcelar"). */
function ActionRow({ label, value, action, onClick, testId }: { label: string; value: string; action?: string; onClick: () => void; testId: string }) {
  return (
    <div className="flex min-h-[38px] items-center justify-between gap-4 border-b border-dashed border-border text-sm">
      <span className="text-muted-foreground">{label}</span>
      {action ? <button type="button" onClick={onClick} data-testid={testId} className="flex items-center gap-1 font-semibold"><span>{value}</span><span className="text-[#a78bfa]">· {action}</span><ChevronRight size={14} className="text-[#a78bfa]" aria-hidden="true" /></button> : <span className="font-semibold">{value}</span>}
    </div>
  );
}

/** The receipt photo over the whole screen, with replace and remove. */
function PhotoViewer({ open, src, onClose, onReplace, onRemove }: { open: boolean; src: string | null; onClose: () => void; onReplace: () => void; onRemove: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="photo" className="fixed inset-0 z-[86] flex flex-col bg-black/95 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="Foto do comprovante" data-testid="record-photo-viewer">
          <div className="flex items-center gap-3 px-4">
            <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-10 shrink-0 place-items-center rounded-full border border-white/20 text-white"><X size={20} /></button>
            <span className="text-[17px] font-bold text-white">Foto do comprovante</span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">{src ? <motion.img src={src} alt="Foto do comprovante" className="max-h-full max-w-full rounded-2xl object-contain" initial={{ scale: 0.94 }} animate={{ scale: 1 }} /> : <span className="text-white/60">Carregando…</span>}</div>
          <div className="flex gap-2 px-4">
            <button type="button" onClick={onReplace} className="h-12 flex-1 rounded-full bg-white/10 text-[15px] font-semibold text-white">Trocar foto</button>
            <button type="button" onClick={onRemove} className="h-12 flex-1 rounded-full border border-[#5b1a2e] text-[15px] font-semibold text-[#fb7185]">Remover</button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** A saved lançamento, under the register's fields: what it changed, then the full receipt as it scrolls. */
const HINT_KEY = "finnos:record-scroll-hint";
/** Category colours lightened a little so dark ones (navy, purple) stay readable on the dark background. */
const readable = (c?: string | null) => (c ? `color-mix(in oklab, ${c} 72%, white)` : undefined);
const SUBSCRIPTION_HINTS = ["netflix", "spotify", "disney", "prime video", "amazon prime", "hbo", "max", "globoplay", "deezer", "youtube premium", "apple music", "icloud", "google one", "chatgpt", "claude", "xbox", "playstation", "gympass", "wellhub", "smart fit", "academia", "paramount", "crunchyroll", "dropbox", "adobe", "canva", "microsoft 365", "office 365", "ifood clube", "uber one", "mercado livre", "meli+"];
/** A short code to find this lançamento again ("#7KQ2MX"). */
export const receiptCode = (id: string) => { let h = 2166136261; for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return "#" + (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6); };
const shortDate = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

export function RecordInsight({ tx, onDeleted, onLeave, onSettle, settling, onChanged, onRepeat }: { tx: Transaction; onDeleted: () => void; /** Leaving for another screen (the Caixa). */ onLeave: () => void; /** Marks it paid (or received) now. */ onSettle?: () => void; settling?: boolean; /** The lançamento was changed here (photo, series, history): show it again as it is now. */ onChanged?: (tx: Transaction) => void; /** "Lançar de novo": a new register with the same fields, dated today. */ onRepeat?: () => void }) {
  const { hidden } = useBalanceHidden();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const hasPhoto = tx.attachment === ATTACHMENT_MARKER;
  const photo = useQuery({ queryKey: ["attachment", tx.id, tx.version], queryFn: () => fetchAttachment(tx.id), enabled: hasPhoto && !tx.id.startsWith("offline:"), staleTime: 300_000 });
  // One place for the changes made from this screen: run, refresh everything, show the lançamento as it is now.
  const change = async (key: string, run: () => Promise<Transaction>, ok: string) => {
    if (working) return;
    setWorking(key);
    try { const updated = await run(); await refresh(); toast.success(ok); onChanged?.(updated); }
    catch (error) { toast.error(error instanceof Error && error.message ? error.message : "Não foi possível salvar agora."); }
    finally { setWorking(null); }
  };
  // "Role para ver o comprovante" only for the first few openings.
  const [showHint] = useState(() => { try { const n = Number(localStorage.getItem(HINT_KEY) || 0); localStorage.setItem(HINT_KEY, String(n + 1)); return n < 3; } catch { return true; } });
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const month = tx.date.slice(0, 7);
  const enabled = !tx.id.startsWith("offline:");
  const spends = enabled && tx.type === "despesa";
  const historyQuery = useQuery({ queryKey: ["transaction-history", tx.id, tx.version], queryFn: () => fetchTransactionHistory(tx.id), enabled, retry: 1 });
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month), enabled: spends, staleTime: 60_000 });
  const cycle = useQuery({ queryKey: ["budget-v2-current"], queryFn: fetchCurrentBudgetCycle, enabled: spends, staleTime: 60_000 });
  const cycleProgress = useQuery({ queryKey: ["budget-v2-progress", cycle.data?.id], queryFn: () => fetchBudgetCycleProgress(cycle.data!.id), enabled: spends && Boolean(cycle.data?.id) });
  const calendar = useQuery({ queryKey: ["calendar", month, "todas"], queryFn: () => fetchCalendar(month), enabled, staleTime: 60_000 });
  const history = useQuery({
    queryKey: ["transactions", "insight", tx.name, month],
    queryFn: () => fetchTransactions({ search: tx.name.slice(0, 80), start_date: `${addMonth(month, -5)}-01`, end_date: `${month}-31` }),
    enabled, staleTime: 60_000,
  });
  const subscriptions = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions, enabled, staleTime: 60_000 });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards, enabled: enabled && Boolean(tx.card_id), staleTime: 60_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 300_000 });
  const goals = useQuery({ queryKey: ["goals", me.data?.id], queryFn: () => listGoals(me.data!.id), enabled: Boolean(me.data?.id) && tx.type !== "receita", staleTime: 60_000 });
  const navigate = useNavigate();
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []);
  const openCategory = () => { if (!tx.category_id) return; onLeave(); navigate(categoryFlowPath(tx.category_id, month, tx.type === "receita" ? "receitas" : "despesas")); };

  const fromCycle = cycleImpact(tx, cycleProgress.data);
  // Older lançamentos (imported, restored, or created before the history existed) still show when they were made.
  const SOURCE_LABEL: Record<string, string> = { manual: "Registro manual", apple_pay: "Apple Pay", ai: "Registro inteligente", import: "Importação", offline: "Sem conexão (sincronizado depois)", shortcut: "Atalho do iPhone", sync: "Sincronização" };
  const createdSource = historyQuery.data?.slice().reverse().find((e) => e.action === "created")?.after?.source as string | undefined;
  const createdVia = createdSource ? SOURCE_LABEL[createdSource] ?? createdSource : null;
  const events = historyQuery.data?.length ? historyQuery.data : historyQuery.isSuccess || historyQuery.isError
    ? [{ id: "created", action: "created" as const, created_at: tx.created_at, before: null, after: { name: tx.name, value_cents: Math.round(tx.value * 100), date: tx.date } }] : [];
  const impact = fromCycle ?? budgetImpact(tx, budget.data);
  const month_ = monthImpact(tx, calendar.data);
  const same = (history.data ?? []).filter((r) => r.type === tx.type && norm(r.name) === norm(tx.name) && r.date.slice(0, 7) === month);
  const position = same.filter((r) => r.date < tx.date || (r.date === tx.date && r.created_at <= tx.created_at)).length || 1;
  const total = same.reduce((s, r) => s + r.value, 0);
  const repeats = rhythm(tx, history.data ?? [], subscriptions.data?.items ?? []);
  const canSplit = tx.type === "despesa" && Boolean(tx.card_id) && !tx.installment && !tx.fixed && !tx.invoice_payment;
  const looksLikeSubscription = tx.type === "despesa" && SUBSCRIPTION_HINTS.some((k) => norm(tx.name).includes(k));
  const subscriptionHint = looksLikeSubscription && subscriptions.isSuccess && !(subscriptions.data?.items ?? []).some((sub) => norm(sub.name) === norm(tx.name) || norm(tx.name).includes(norm(sub.name)));
  const suggestFixed = !tx.fixed && !tx.installment && !tx.invoice_payment && tx.type !== "transferencia" && repeats.kind === "repete" && repeats.times >= 3;
  const signed = signedAmount(tx);
  const created = tx.created_at ? new Date(tx.created_at) : null;
  const when = created && !Number.isNaN(created.getTime()) ? `${created.toLocaleDateString("pt-BR")} · ${created.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : tx.date.split("-").reverse().join("/");
  const origin = tx.origin || (tx.capture ? "Apple Pay" : "Registro manual");
  const statusLabel = tx.status === "pago" ? (tx.type === "receita" ? "Recebido" : "Pago") : tx.status === "pendente" ? "Pendente" : tx.status === "agendado" ? "Agendado" : tx.status;

  const done = tx.status === "pago";
  const card = tx.card_id ? cards.data?.find((c) => c.id === tx.card_id) : undefined;
  const daysLeft = Math.max(1, Number(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()) - Number(todayISO().slice(8, 10)) + 1);
  // When the month closes below what the goals need this month, the first unfinished goal is the one that waits.
  const openGoals = (goals.data ?? []).filter((g) => g.saved < g.target && g.contribution > 0);
  const neededForGoals = openGoals.reduce((sum, g) => sum + g.contribution, 0);
  const atRiskGoal = month_ && tx.type === "despesa" && openGoals.length && month_.closes < neededForGoals ? openGoals[0] : null;
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
    ...(tx.type !== "transferencia" ? [[`${tx.name.length > 22 ? tx.name.slice(0, 21) + "…" : tx.name} no mês`, same.length <= 1 ? "o único" : `${position}º de ${same.length}`, undefined] as [string, string, undefined]] : []),
    ...(impact && !over && month === todayISO().slice(0, 7) && tx.type === "despesa" ? [[`Sobra por dia em ${impact.name}`, `${money(impact.remaining / daysLeft)}/dia`, undefined] as [string, string, undefined]] : []),
    ...(month_?.ofIncome != null ? [["Peso na renda do mês", `${Math.max(1, Math.round(month_.ofIncome * 100))}%`, month_.ofIncome >= 0.2 ? "#fbbf24" : undefined] as [string, string, string | undefined]] : []),
    ...(card ? [[`Limite livre no ${card.name}`, money(card.available), card.available < 0.1 * card.limit ? "#fbbf24" : undefined] as [string, string, string | undefined], [`Fatura atual do ${card.name}`, money(card.current_invoice), undefined] as [string, string, undefined]] : []),
    ...(month_ ? [[done ? "Mês fecha em" : "Mês deve fechar em", money(month_.closes), month_.closes < 0 ? "#fb7185" : undefined] as [string, string, string | undefined]] : []),
    ...(atRiskGoal ? [["Pode atrasar a meta", atRiskGoal.name, "#fbbf24"] as [string, string, string]] : []),
  ];
  const impactSentence = [`${tx.name}: ${impactRows[0][0]} ${hidden ? "" : impactRows[0][1].replace("−", "menos ")}`, impact ? (over ? `passou o orçamento de ${impact.name}` : `usa ${Math.round(impact.share * 100)}% do orçamento de ${impact.name}`) : "", month_ ? `o mês deve fechar em ${hidden ? "valor oculto" : formatBRL(month_.closes)}` : ""].filter(Boolean).join(", ") + ".";
  // The same name in the previous months: is this one higher or lower than usual?
  const months = Array.from({ length: 6 }, (_, i) => addMonth(month, i - 5));
  const bars = monthlyHistory(tx, history.data ?? [], months);
  const previous = bars.slice(0, -1).filter((b) => b.total > 0);
  const recent = previous.slice(-3);
  const average = recent.length ? recent.reduce((t, b) => t + b.total, 0) / recent.length : 0;
  const thisMonth = bars[bars.length - 1]?.total || tx.value;
  const trend = average > 0 ? (thisMonth - average) / average : 0;
  const peak = Math.max(...bars.map((b) => b.total), tx.value, 1);
  // Clearly off the usual: 30% (and R$ 10) above the average for expenses, below it for income.
  const unusual = average > 0 && tx.type !== "transferencia" && Math.abs(thisMonth - average) >= 10 && (tx.type === "receita" ? trend <= -0.3 : trend >= 0.3);

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

  const share = async () => {
    try {
      const rows: [string, string][] = [["Quando", when], [tx.type === "transferencia" ? "Sai de" : "Como pagou", tx.card_name ? `Crédito · ${tx.card_name}` : tx.account_name],
        ...(tx.to_account_name ? [["Vai para", tx.to_account_name] as [string, string]] : []), ...(tx.category_name ? [["Categoria", tx.category_name] as [string, string]] : []),
        ["Data", tx.date.split("-").reverse().join("/")], ["Status", statusLabel], ["Origem", origin]];
      const blob = await receiptImage({ title: tx.name, amount: `${tx.type === "receita" ? "+" : tx.type === "despesa" ? "−" : ""}${formatBRL(tx.value)}`, tone: tx.type === "receita" ? "#34d399" : tx.type === "despesa" ? "#fb7185" : "#c4b5fd", rows });
      const how = await shareImage(blob, `comprovante-${tx.date}.png`, `${tx.name} · ${formatBRL(tx.value)}`);
      if (how === "downloaded") toast.success("Imagem do comprovante baixada.");
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) toast.error("Não foi possível compartilhar agora."); }
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
      {/* Quick actions on a saved lançamento. */}
      <div className="flex shrink-0 gap-2">
        {onRepeat ? <button type="button" onClick={onRepeat} data-testid="record-repeat" className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 text-[13px] font-semibold"><Copy size={15} className="text-[#a78bfa]" aria-hidden="true" />Lançar de novo</button> : null}
        <button type="button" onClick={() => void share()} data-testid="record-share" className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 text-[13px] font-semibold"><Share2 size={15} className="text-[#a78bfa]" aria-hidden="true" />Compartilhar</button>
        <button type="button" onClick={() => (hasPhoto ? setPhotoOpen(true) : photoInput.current?.click())} data-testid="record-photo-action" className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 text-[13px] font-semibold"><Camera size={15} className="text-[#a78bfa]" aria-hidden="true" />{hasPhoto ? "Ver foto" : "Foto"}</button>
      </div>
      <input ref={photoInput} type="file" accept="image/*" className="hidden" data-testid="record-photo-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void change("photo", () => addTransactionPhoto(tx, f), "Foto do comprovante salva."); }} />
      {unusual ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex shrink-0 items-start gap-3 rounded-[20px] border border-amber-500/30 bg-amber-500/10 px-4 py-3" data-testid="record-unusual">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="text-sm"><span className="font-bold text-amber-300">{tx.type === "receita" ? "Veio menos que o normal." : "Veio mais alto que o normal."}</span> {money(Math.abs(thisMonth - average))} {thisMonth > average ? "acima" : "abaixo"} da média de {money(average)}.</p>
        </motion.div>
      ) : null}
      {suggestFixed ? (
        <div className="flex shrink-0 items-center gap-3 rounded-[20px] border border-primary/30 bg-primary/10 px-4 py-3 dark:bg-[#17132e]" data-testid="record-suggest-fixed">
          <Repeat size={18} className="shrink-0 text-[#a78bfa]" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">Isso aparece todo mês. <span className="text-muted-foreground">Quer que o FINNOS já preveja os próximos?</span></p>
          <button type="button" onClick={() => setFixOpen(true)} className="h-9 shrink-0 rounded-full bg-[#7c3aed] px-3.5 text-sm font-bold text-white">Tornar fixa</button>
        </div>
      ) : null}
      {!online ? <p className="shrink-0 rounded-full bg-muted px-4 py-2 text-center text-xs text-muted-foreground" data-testid="record-offline">Sem conexão: mostrando o que já está salvo no aparelho.</p> : null}
      {subscriptionHint ? (
        <div className="flex shrink-0 items-center gap-3 rounded-[20px] border border-sky-500/30 bg-sky-500/10 px-4 py-3" data-testid="record-subscription">
          <CalendarSync size={18} className="shrink-0 text-sky-400" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">Parece uma assinatura. <span className="text-muted-foreground">Cadastre para ver quanto ela custa por ano e ser avisado antes de renovar.</span></p>
          <Link to="/assinaturas" onClick={onLeave} className="h-9 shrink-0 rounded-full bg-sky-600 px-3.5 text-sm font-bold leading-9 text-white">Cadastrar</Link>
        </div>
      ) : null}
      <Card title="IMPACTO" label={impactSentence}>
        {impactRows.map(([l, v, t], k) => <Row key={l} label={l} value={tx.category_id && l.startsWith("Orçamento de") ? <button type="button" onClick={openCategory} className="inline-flex items-center gap-0.5" data-testid="record-open-category">{v}<ChevronRight size={14} className="text-[#a78bfa]" aria-hidden="true" /></button> : v} tone={t} i={k} last={k === impactRows.length - 1} />)}
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
            {average <= 0 ? "Primeira vez nos últimos meses." : Math.abs(trend) < 0.05
              ? <>Parecido com a média de {money(average)}.</>
              : <><span className="font-semibold" style={{ color: (trend > 0) === (tx.type !== "receita") ? "#fb7185" : "#34d399" }}>{Math.round(Math.abs(trend) * 100)}% {trend > 0 ? "acima" : "abaixo"}</span> da média dos últimos {recent.length === 1 ? "mês" : `${recent.length} meses`} ({money(average)}).</>}
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
          {tx.category_name ? <Row label="Categoria" value={<button type="button" onClick={openCategory} className="inline-flex items-center gap-0.5 font-semibold" data-testid="record-category-link">{tx.category_name}<ChevronRight size={14} aria-hidden="true" /></button>} tone={readable(tx.category_color)} i={i++} /> : null}
          {createdVia ? <Row label="Registrado via" value={createdVia} i={i++} /> : null}
          <Row label="Código" value={<button type="button" onClick={() => { void navigator.clipboard?.writeText(receiptCode(tx.id)).then(() => toast.success("Código copiado.")); }} className="font-mono tracking-wider" aria-label={`Código ${receiptCode(tx.id)}, tocar para copiar`} data-testid="record-code">{receiptCode(tx.id)}</button>} i={i++} />
          {tx.notes ? <Row label="Nota" value={tx.notes} i={i++} /> : null}
          <Row label="Status" value={statusLabel} tone={tx.status === "pago" ? "#34d399" : "#fbbf24"} i={i++} last={!hasPhoto} />
          {hasPhoto ? (
            <button type="button" onClick={() => setPhotoOpen(true)} className="my-2 block w-full overflow-hidden rounded-2xl border border-border bg-muted" data-testid="record-photo" aria-label="Abrir foto do comprovante">
              {photo.data ? <img src={photo.data} alt="Foto do comprovante" className="max-h-56 w-full object-cover" /> : <span className="flex h-24 items-center justify-center text-sm text-muted-foreground">{photo.isPending ? "Carregando foto…" : "Foto indisponível"}</span>}
            </button>
          ) : (
            <button type="button" onClick={() => photoInput.current?.click()} disabled={working === "photo"} data-testid="record-photo-add" className="my-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[#3a3b6a] text-sm font-medium text-primary dark:text-[#c4b5fd]">
              <Camera size={16} aria-hidden="true" />{working === "photo" ? "Salvando foto…" : "+ Foto do comprovante"}
            </button>
          )}
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
        <ActionRow label={tx.type === "receita" ? "Receita fixa" : "Despesa fixa"} value={tx.fixed ? "Sim · mensal" : "Não"} action={!tx.fixed && !tx.installment && tx.type !== "transferencia" && !tx.invoice_payment ? "Tornar fixa" : undefined} onClick={() => setFixOpen(true)} testId="record-make-fixed" />
        <ActionRow label="Parcelado" value={tx.installment && tx.total_installments ? `${tx.current_installment ?? 1} de ${tx.total_installments}` : "Não"} action={canSplit ? "Parcelar" : undefined} onClick={() => setSplitOpen(true)} testId="record-split" />
        <Row label="Repetição" value={repeats.kind === "unica" ? "Avulso" : repeats.kind === "repete" ? `${repeats.times}× em 6 meses` : repeats.kind === "assinatura" ? "Assinatura" : repeats.kind === "fixa" ? "Fixa" : "Avulso"} i={2} />
        <button type="button" onClick={() => setHistoryOpen(true)} data-testid="record-history-open" className="flex min-h-[38px] w-full items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Histórico de alterações</span>
          <span className="flex items-center gap-1 font-semibold">{historyQuery.isPending ? "…" : events.length}<ChevronRight size={15} className="text-[#a78bfa]" aria-hidden="true" /></span>
        </button>
      </Card>
      <HistorySheet open={historyOpen} events={events} onClose={() => setHistoryOpen(false)}
        onRestore={(patch) => { setHistoryOpen(false); void change("restore", () => updateTransaction(tx.id, transactionInput(tx, patch), "manual", tx.version), "Alteração desfeita."); }} />
      <ChoiceSheet open={fixOpen} title="Tornar fixa (mensal)?" text={`O FINNOS passa a prever "${tx.name}" todo mês, no dia ${Number(tx.date.slice(8, 10))}, com ${money(tx.value)}. Dá para mudar ou encerrar depois.`} testId="record-fixed-sheet"
        choices={[{ key: "yes", label: "Sim, se repete todo mês", hint: "Os próximos meses aparecem como previstos.", icon: <Repeat size={18} /> }]}
        onClose={() => setFixOpen(false)} onPick={() => { setFixOpen(false); void change("fixed", () => updateTransaction(tx.id, transactionInput(tx, { fixed: true, recurrence: "mensal" }), "manual", tx.version), "Agora é uma despesa fixa."); }} />
      <ChoiceSheet open={splitOpen} title="Parcelar no cartão" text={`${money(tx.value)} em quantas vezes?`} testId="record-split-sheet"
        choices={[2, 3, 4, 5, 6, 8, 10, 12].map((n) => ({ key: String(n), label: `${n}x de ${money(tx.value / n)}`, hint: n === 2 ? "A primeira parcela é a deste mês." : undefined }))}
        onClose={() => setSplitOpen(false)} onPick={(k) => { setSplitOpen(false); const n = Number(k); void change("split", () => updateTransaction(tx.id, transactionInput(tx, { installment: true, total_installments: n, current_installment: 1 }), "manual", tx.version), `Parcelado em ${n}x.`); }} />
      <PhotoViewer open={photoOpen} src={photo.data ?? null} onClose={() => setPhotoOpen(false)} onReplace={() => { setPhotoOpen(false); photoInput.current?.click(); }}
        onRemove={() => { setPhotoOpen(false); void change("photo", () => removeTransactionPhoto(tx), "Foto removida."); }} />
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
