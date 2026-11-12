import { useEffect, useMemo, useRef, useState } from "react";
import { defaultAccount } from "@/lib/walletDefaults";
import { categoryFlowPath } from "@/lib/categoryLinks";
import { useNavigate } from "react-router-dom";
import { parseReceiptText, parseRegisterText } from "@/lib/registerParsing";
import { registerProposal, type Proposal, type ProposalState, type ProposedEntry } from "@/lib/finnActions";
import { applyProposal, undoProposal } from "@/lib/finnApply";
import { readMemory } from "@/lib/finnMemory";
import { ProposalCard } from "@/components/ai/ProposalCard";
import { getRegisterCalc, getRegisterDefault, setRegisterCalc } from "@/lib/registerPreferences";
import { motion } from "motion/react";
import { isLocalMode } from "@/lib/mode";
import { openRegisterSheet } from "@/lib/registerSheet";
import { SeriesScopeSheet } from "@/components/transactions/SeriesScopeSheet";
import { RecordInsight } from "@/components/transactions/RecordInsight";
import { DatePickerSheet } from "@/components/shared/DatePickerSheet";
import { KIND_THEME, RegisterSuccess } from "@/components/transactions/RegisterSuccess";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { evaluateExpression, KEYS, OPS, pressKey, typedDisplay } from "@/lib/registerKeypad";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PendingCapture, Transaction, TransactionInput } from "@/types/finnos";
import { confirmBody, type CaptureChoice } from "@/lib/pendingCaptures";
import { addTransactionPhoto, editRecurrence, settleTransaction, type RecurrenceEditScope, confirmPendingCapture, createTransaction, fetchTransactionById, updateTransaction, fetchOrigins, fetchAccounts, fetchCards, fetchCategories, fetchTransactions } from "@/lib/data";
import { getAccountPaymentMethods } from "@/lib/accountPaymentPreferences";
import { addMonth, formatBRL, isISODate, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { ArrowLeft, ArrowUp, Camera, Check, ChevronLeft, Pencil, ChevronRight, Mic, Paperclip, Plus, X, Wallet, CreditCard, Landmark, Repeat2, StickyNote, Bell, Tag, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Delete, MoreVertical, Search, WandSparkles, Sparkles, Eye, EyeOff, ReceiptText, Square, Calculator } from "lucide-react";

/** Voice, receipt photo and file attachment are hidden until they work reliably on every phone; the code stays. */
const MEDIA_INPUTS = false;

type Page = "entry" | "pay" | "start" | "manual" | "details" | "categories" | "accounts" | "installments" | "more" | "voice" | "receipt" | "review" | "recognized" | "done";
type Kind = "Despesa" | "Receita" | "Transferência";
const format = (n: string) => (Number(n || 0) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const KIND_UI: Record<Kind, { icon: typeof ArrowDownLeft; tint: string; amount: string }> = {
  Receita: { icon: ArrowDownLeft, tint: "bg-income/12 text-income", amount: KIND_THEME.Receita.amount },
  Despesa: { icon: ArrowUpRight, tint: "bg-expense/12 text-expense", amount: KIND_THEME.Despesa.amount },
  "Transferência": { icon: ArrowLeftRight, tint: "bg-primary/12 text-primary", amount: KIND_THEME["Transferência"].amount },
};
const SUB_TITLES: Partial<Record<Page, string>> = { pay: "Escolher carteira", accounts: "Escolher carteira", categories: "Escolher categoria", more: "Mais opções", installments: "Parcelamento" };
const MORE_CARD = "rounded-[20px] border border-border/70 bg-card";
const WALLET_TONES = ["bg-income/15 text-income dark:bg-[#0d2a22] dark:text-[#10b981]", "bg-amber-500/15 text-amber-500 dark:bg-[#2a1a0c] dark:text-[#fb923c]", "bg-sky-500/15 text-sky-500 dark:bg-[#0c2330] dark:text-[#38bdf8]", "bg-pink-500/15 text-pink-500 dark:bg-[#2a1020] dark:text-[#ec4899]"];
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Same day next month (clamped), the next occurrence of a monthly series. */
const nextMonthlyDate = (iso: string) => { const today = todayISO(); const ref = iso > today ? iso : today; const [y, m] = ref.slice(0, 7).split("-").map(Number); const day = Number(iso.slice(8, 10)); const max = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); const next = new Date(Date.UTC(y, m, 1)); return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, max)).padStart(2, "0")}`; };
const KIND_OF = (t: Transaction["type"]): Kind => (t === "receita" ? "Receita" : t === "transferencia" ? "Transferência" : "Despesa");
/** Prototype colours per type: chosen chip, amount and caret (dark values from the prototype). */
const PROTO_TONE: Record<Kind, { chip: string; text: string; caret: string }> = {
  Despesa: { chip: "bg-expense/12 text-expense dark:bg-[#3a1020] dark:text-[#ff6b88]", text: "text-expense dark:text-[#fb7185]", caret: "bg-expense dark:bg-[#fb7185]" },
  Receita: { chip: "bg-income/12 text-income dark:bg-[#0d2a22] dark:text-[#34d399]", text: "text-income dark:text-[#34d399]", caret: "bg-income dark:bg-[#34d399]" },
  "Transferência": { chip: "bg-primary/12 text-primary dark:bg-[#1d1640] dark:text-[#c4b5fd]", text: "text-primary dark:text-[#c4b5fd]", caret: "bg-primary dark:bg-[#c4b5fd]" },
};
/** What the floating button needs to know: the "+" turns into ✕ (nothing typed) or ✓ in the type's colour. */
export interface RegisterController {
  view: "entry" | "success" | "other";
  kind: Kind;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  hint: string | null;
  /** A saved lançamento with its receipt open over the whole screen. */
  expanded?: boolean;
  save: () => void;
}
export default function SmartRegister({ embedded = false, desktop = false, capture, existing, siblings, initialKind, template, onClose, onController }: { initialKind?: Kind; /** The list the lançamento came from: swipe or arrows go to the previous and next. */ siblings?: Transaction[]; /** "Lançar de novo": a new entry with the fields of this one, dated today. */ template?: Transaction; embedded?: boolean; desktop?: boolean; /** A saved lançamento: opens in the same screen, with its impact and receipt below; ✓ saves changes. */ existing?: Transaction; /** An Apple Pay purchase being reviewed: same screens, prefilled; saving confirms it. */ capture?: { item: PendingCapture; choice: CaptureChoice }; onClose?: () => void; onController?: (controller: RegisterController) => void }) {
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const { hidden, toggle: toggleHidden } = useBalanceHidden();
  const [expr, setExpr] = useState(() => ((existing ?? template) ? (Number.isInteger((existing ?? template)!.value) ? String((existing ?? template)!.value) : (existing ?? template)!.value.toFixed(2).replace(".", ",")) : capture ? String(capture.item.value).replace(".", ",") : ""));
  const [done, setDone] = useState<{ kind: Kind; amount: string; name: string; chips: string[]; transaction: Transaction } | null>(null);
  const [calc, setCalc] = useState(getRegisterCalc);
  const [keypadOpen, setKeypadOpen] = useState(!existing);
  const [listening, setListening] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<{ stop: () => void } | null>(null);
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  // Memoized: a new array every render would re-run the effects below for nothing.
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const accounts = useMemo(() => (accountsQuery.data ?? []).filter(a => a.active), [accountsQuery.data]);
  const cards = useMemo(() => (cardsQuery.data ?? []).filter(c => c.active), [cardsQuery.data]);
  const cardsForAccount = (accountId: string) => cards.filter(c => c.payment_account_id === accountId || (!c.payment_account_id && (!c.institution || c.institution.toLocaleLowerCase("pt-BR") === accounts.find(a => a.id === accountId)?.institution?.toLocaleLowerCase("pt-BR"))));
  const [paymentPreferencesVersion, setPaymentPreferencesVersion] = useState(0);
  const [availablePayments, setAvailablePayments] = useState<string[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState(false);
  useEffect(() => { const listener = () => setPaymentPreferencesVersion(v => v + 1); window.addEventListener("finnos:payment-methods-changed", listener); return () => window.removeEventListener("finnos:payment-methods-changed", listener); }, []);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(() => (existing ?? template) ? (existing ?? template)!.card_id : (capture?.choice.method === "credito" && capture.choice.cardId ? capture.choice.cardId : null));
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  useEffect(() => {
    const selected = accounts.find(a => a.id === institutionId);
    if (!selected) { setAvailablePayments([]); return; }
    let cancelled = false;
    setPaymentsLoading(true); setPaymentsError(false); setAvailablePayments([]);
    getAccountPaymentMethods(selected).then(methods => { if (!cancelled) setAvailablePayments(methods); }).catch(() => { if (!cancelled) setPaymentsError(true); }).finally(() => { if (!cancelled) setPaymentsLoading(false); });
    return () => { cancelled = true; };
  }, [institutionId, paymentPreferencesVersion, accounts]);
  const selectedCard = cards.find(c => c.id === selectedCardId);
  // Opens on the screen chosen in Configurações → Novo registro.
  const [page, setPage] = useState<Page>(() => (!existing && !capture && getRegisterDefault() === "inteligente" ? "start" : "entry"));
  const [history, setHistory] = useState<Page[]>([]);
  const [text, setText] = useState("");
  const [value, setValue] = useState(() => ((existing ?? template) ? String((existing ?? template)!.value) : capture ? String(capture.item.value) : ""));
  const [name, setName] = useState(() => (existing ?? template)?.name ?? capture?.item.name ?? "");
  const [kind, setKind] = useState<Kind>(() => (existing ? KIND_OF(existing.type) : template ? KIND_OF(template.type) : initialKind ?? "Despesa"));
  const [category, setCategory] = useState(() => (existing ?? template)?.category_id ?? capture?.choice.categoryId ?? "");
  const [account, setAccount] = useState(() => (existing ?? template)?.account_id ?? capture?.choice.accountId ?? "");
  const selectedAccount = accounts.find(a => a.id === account);
  const [destination, setDestination] = useState(() => (existing ?? template)?.to_account_id ?? "");
  const [installments, setInstallments] = useState(1);
  const [date, setDate] = useState(() => existing?.date ?? capture?.item.date ?? todayISO());
  const [note, setNote] = useState(() => existing?.notes ?? "");
  const [origin, setOrigin] = useState(() => (existing ?? template)?.origin ?? "");
  const [dateOpen, setDateOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const recordScroll = useRef<HTMLDivElement>(null);
  const collapsing = useRef(false);
  const swipeStart = useRef<number | null>(null);
  const swiped = useRef(false);
  const position = existing && siblings ? siblings.findIndex((t) => t.id === existing.id) : -1;
  const goSibling = (step: number) => {
    if (position < 0 || !siblings) return;
    const next = siblings[position + step]; if (!next) return;
    if (dirtyRef.current) { toast("Salve ou descarte as alterações antes de ir para outro lançamento."); return; }
    openRegisterSheet({ existing: next, siblings });
  };
  // The chosen category sits in the middle of its strip, so it is always visible with its name below.
  const categoryStrip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = categoryStrip.current; if (!strip || !category) return;
    const chip = strip.querySelector<HTMLElement>('[aria-checked="true"]'); if (!chip) return;
    const left = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [category, kind, page, keypadOpen, categoriesQuery.isSuccess]);
  // "Marcar como pago": settles it now and reopens the lançamento with its new state.
  const [settling, setSettling] = useState(false);
  const settle = async () => {
    if (!existing || settling) return;
    if (dirtyRef.current) { toast("Salve as alterações antes de marcar como pago."); return; }
    setSettling(true);
    try {
      const updated = await settleTransaction(existing);
      await refreshFinancialData();
      toast.success(existing.type === "receita" ? "Marcado como recebido." : "Marcado como pago.");
      openRegisterSheet({ existing: updated });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível marcar agora."); } finally { setSettling(false); }
  };
  const dirtyRef = useRef(false);
  // Back to the register as it opened: fields shown, receipt at the top.
  const collapseRecord = () => { collapsing.current = true; setExpanded(false); recordScroll.current?.scrollTo({ top: 0, behavior: "smooth" }); window.setTimeout(() => { collapsing.current = false; }, 900); };
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeRef = useRef<RecurrenceEditScope | null>(null);
  const isSeries = Boolean(existing?.fixed && existing.recurrence_id && !existing.installment && !isLocalMode());
  const [originOpen, setOriginOpen] = useState(false);
  const origins = useQuery({ queryKey: ["origins"], queryFn: fetchOrigins, staleTime: 60_000 });
  const [recurring, setRecurring] = useState(() => Boolean(existing?.fixed));
  const [attachment, setAttachment] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [destinationPicker, setDestinationPicker] = useState(false);
  const [payment, setPayment] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [saveStatus, setSaveStatus] = useState<"synced" | "pending" | null>(null);
  const refreshFinancialData = async () => { await Promise.all(["transactions", "accounts", "dashboard", "cards", "categories", "flow", "calendar"].map(key => queryClient.invalidateQueries({ queryKey: [key] }))); };
  const saveMutation = useMutation({ mutationFn: async (input: TransactionInput): Promise<Transaction> => {
    if (existing) {
      // Moved to a future date, a paid one becomes scheduled (a future lançamento cannot be paid).
      const full: TransactionInput = { ...input, status: existing.status === "pago" && input.date > todayISO() ? "agendado" : existing.status, installment: existing.installment, total_installments: existing.total_installments, current_installment: existing.current_installment, adjusted_value: existing.adjusted_value, attachment: existing.attachment };
      const scope = scopeRef.current;
      if (!scope || scope === "esta") return updateTransaction(existing.id, full, "manual", existing.version);
      // A monthly series: name and value go to the chosen occurrences; anything else stays on this one.
      const changes: { name?: string; value?: number } = {};
      if (full.name !== existing.name) changes.name = full.name;
      if (Math.round(full.value * 100) !== Math.round(existing.value * 100)) changes.value = full.value;
      const others = full.category_id !== existing.category_id || full.account_id !== existing.account_id || full.date !== existing.date || (full.notes ?? "") !== (existing.notes ?? "") || (full.origin ?? "") !== (existing.origin ?? "") || full.card_id !== existing.card_id;
      let current = existing;
      if (others) current = await updateTransaction(existing.id, { ...full, name: existing.name, value: existing.value }, "manual", existing.version);
      if (!Object.keys(changes).length) return current;
      const effective = scope === "todas" ? current.date : current.date >= todayISO() ? current.date : nextMonthlyDate(current.date);
      return editRecurrence(current.id, current.version ?? 1, scope, effective, changes, crypto.randomUUID());
    }
    if (!capture) return createTransaction(input, "manual");
    // Reviewing an Apple Pay purchase: confirm it with the chosen wallet, then apply any edit to value, name, date or origin.
    const credit = Boolean(input.card_id);
    const { transaction_id: id } = await confirmPendingCapture(capture.item.id, confirmBody({ method: credit ? "credito" : "debito", accountId: input.account_id, cardId: input.card_id ?? "", categoryId: input.category_id ?? "", installments: input.installment ? input.total_installments ?? 1 : 1 }));
    const edited = input.name !== capture.item.name || input.value !== capture.item.value || input.date !== capture.item.date || Boolean(input.origin);
    await queryClient.invalidateQueries({ queryKey: ["pending-captures"] });
    return edited ? updateTransaction(id, { ...input, installment: false, total_installments: null, current_installment: null }, "manual") : fetchTransactionById(id);
  }, onSettled: () => { scopeRef.current = null; }, onSuccess: async (transaction) => { setSaveStatus("synced"); await refreshFinancialData(); finishSave(transaction); }, onError: async (error: Error) => { if (error.message.includes("FINNOS_OFFLINE_QUEUED")) { setSaveStatus("pending"); await refreshFinancialData(); finishSave(null); toast.info("Registro salvo neste dispositivo. Sincronização pendente."); return; } toast.error(error.message && !/^(HTTP\b|Failed to fetch|NetworkError)/i.test(error.message) ? `Não foi possível salvar: ${error.message}` : "Não foi possível salvar. O registro não foi confirmado; tente novamente."); } });
  const save = () => {
    if (!canSave) return;
    // Saving an edit to a monthly series asks which months it applies to first.
    if (isSeries && !scopeRef.current) { setScopeOpen(true); return; }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || !account || !isISODate(date) || (kind !== "Transferência" && !category) || (kind === "Transferência" && (!destination || destination === account))) return;
    const input: TransactionInput = { name: displayName, value: amount, type: kind === "Despesa" ? "despesa" : kind === "Receita" ? "receita" : "transferencia", status: date > todayISO() ? "agendado" : "pago", date, account_id: account, card_id: kind === "Despesa" ? selectedCardId : null, to_account_id: kind === "Transferência" ? destination : null, category_id: kind === "Transferência" ? null : category, fixed: recurring, recurrence: recurring ? "mensal" : null, installment: kind === "Despesa" && !!selectedCardId && installments > 1, total_installments: kind === "Despesa" && !!selectedCardId && installments > 1 ? installments : null, current_installment: kind === "Despesa" && !!selectedCardId && installments > 1 ? 1 : null, adjusted_value: null, attachment: null, notes: [note.trim(), payment && kind !== "Transferência" ? `Forma de pagamento: ${payment}` : "", project.trim() ? `Projeto: ${project.trim()}` : "", tags.trim() ? `Tags: ${tags.trim()}` : ""].filter(Boolean).join("\n") || null, origin: origin.trim() || null, notify_enabled: reminder };
    saveMutation.mutate(input);
  };
  
  useEffect(() => { if (categoriesQuery.isSuccess && category && !categories.some(c => c.id === category)) setCategory(""); }, [categories, category, categoriesQuery.isSuccess]);
  useEffect(() => { if (accountsQuery.isSuccess && account && !accounts.some(a => a.id === account)) setAccount(""); }, [accounts, account, accountsQuery.isSuccess]);
  // The default account comes first (changeable in the chip); without one, the oldest active.
  useEffect(() => { if (!account && accounts.length > 0) setAccount((defaultAccount(accounts) ?? accounts[0]).id); }, [accounts, account]);
  useEffect(() => { if (cardsQuery.isSuccess && selectedCardId && !cards.some(c => c.id === selectedCardId)) setSelectedCardId(null); }, [cards, selectedCardId, cardsQuery.isSuccess]);
  const selectedCategory = categories.find(c => c.id === category);
  const visibleCategories = selectedCategory && !categories.slice(0, 4).some(c => c.id === selectedCategory.id) ? [...categories.slice(0, 3), selectedCategory] : categories.slice(0, 4);
  const canSave = Number(value) > 0 && !!account && (kind === "Transferência" ? !!destination && destination !== account : !!category && !(kind === "Despesa" && selectedCategory?.name.toLocaleLowerCase("pt-BR") === "renda"));
  const accountLabel = selectedCard ? `${selectedCard.name} · Crédito` : selectedAccount ? [selectedAccount.name, payment].filter(Boolean).join(" · ") : "Selecionar";
  const [reminder, setReminder] = useState(false);
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");
  const go = (p: Page) => { setHistory(h => [...h, page]); setPage(p); };
  const back = () => { setPage(history.at(-1) || "entry"); setHistory(h => h.slice(0, -1)); };
  // Saved: the success screen shows what was recorded; from there the person starts another entry or opens it.
  const resetForm = () => {
    setExpr(""); setValue(""); setName(""); setNote(""); setOrigin(""); setOriginOpen(false); setCategory(""); setAttachment(""); setText(""); setProject(""); setTags("");
    setRecurring(false); setReminder(false); setInstallments(1); setDestination(""); setKeypadOpen(true);
    setHistory([]); setPage("entry");
  };
  const finishSave = (transaction: Transaction | null) => {
    // The photo chosen in Mais opções goes with the new lançamento once it exists.
    if (transaction && photoFile && !existing) { const f = photoFile; setPhotoFile(null); void addTransactionPhoto(transaction, f).catch(() => toast.error("O lançamento foi salvo, mas a foto não. Adicione de novo no comprovante.")); }
    const chips = [kind === "Transferência" ? [selectedAccount?.name, accounts.find(a => a.id === destination)?.name].filter(Boolean).join(" → ") : selectedCategory?.name, selectedCard ? selectedCard.name : kind === "Transferência" ? "" : selectedAccount?.name, dateLabel, origin.trim() || (capture ? "Apple Pay" : "Registro")].filter((c): c is string => !!c);
    setDone({ kind, amount: formatBRL(Number(value)).replace(/,00$/, ""), name: displayName, chips, transaction: transaction as Transaction });
  };
  const applyParsed = (parsed: { value?: number | null; kind?: Kind; date?: string | null; accountId?: string | null; destinationId?: string | null; categoryId?: string | null; name?: string }) => {
    if (parsed.value) setExpr(String(parsed.value).replace(".", ","));
    if (parsed.kind) setKind(parsed.kind);
    if (parsed.date && isISODate(parsed.date)) setDate(parsed.date);
    if (parsed.accountId) { setAccount(parsed.accountId); setSelectedCardId(null); }
    if (parsed.destinationId) setDestination(parsed.destinationId);
    if (parsed.categoryId) setCategory(parsed.categoryId);
    if (parsed.name) setName(parsed.name);
    setHistory([]); setPage("entry");
  };
  // What was heard or typed becomes one entry per amount, reviewed before anything is saved
  // ("café 3,80 e uber 14 hoje"). Transfers keep the single-entry form, which knows both accounts.
  const [recognized, setRecognized] = useState<{ heard: string; proposal: Proposal; state: ProposalState } | null>(null);
  const habitsQuery = useQuery({
    queryKey: ["transactions", "register-habits"],
    queryFn: () => fetchTransactions({ start_date: `${addMonth(todayISO().slice(0, 7), -5)}-01`, end_date: todayISO() }),
    staleTime: 60_000,
  });
  const interpret = (source = text) => {
    if (!source.trim()) return;
    const found = registerProposal(source, {
      today: todayISO(), accounts, categories, transactions: habitsQuery.data ?? [], subscriptions: [], aliases: readMemory().aliases,
    }, { intent: true });
    if (found?.kind === "register") {
      setRecognized({ heard: source.trim(), proposal: found, state: { status: "pending" } });
      go("recognized");
      return;
    }
    applyParsed(parseRegisterText(source, { accounts, categories, today: todayISO() }));
  };
  const openInForm = (entry: ProposedEntry) => applyParsed({
    value: entry.value, kind: entry.type === "receita" ? "Receita" : "Despesa", date: entry.date,
    accountId: entry.accountId, categoryId: entry.categoryId, name: entry.name,
  });
  // Voice: the browser's own speech recognition (pt-BR), no server involved.
  const startVoice = () => {
    const Speech = (window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechLike }).webkitSpeechRecognition;
    if (!Speech) { toast.error("Este navegador não reconhece voz. Digite a frase."); return; }
    const rec = new Speech();
    rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = false;
    let heard = "";
    rec.onresult = (event) => { heard = Array.from(event.results).map((r) => r[0].transcript).join(" "); setText(heard); };
    rec.onerror = (event) => { setListening(false); if (event.error === "not-allowed") toast.error("Permita o microfone para falar o registro."); };
    rec.onend = () => { setListening(false); recognition.current = null; if (heard.trim()) interpret(heard); };
    recognition.current = rec; setText(""); setListening(true); rec.start();
  };
  const stopVoice = () => recognition.current?.stop();
  // Photo or file: on-device OCR in Portuguese for images; text files are read directly.
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setAttachment(file.name);
    try {
      let content = "";
      if (file.type.startsWith("image/")) {
        setOcrProgress(0);
        const { recognize } = await import("tesseract.js");
        const result = await recognize(file, "por", { logger: (m: { status: string; progress: number }) => { if (m.status === "recognizing text") setOcrProgress(Math.round(m.progress * 100)); } });
        content = result.data.text;
      } else if (/\.(txt|csv)$/i.test(file.name) || file.type.startsWith("text/")) {
        content = await file.text();
      } else {
        toast.info("Por enquanto o FINNOS lê fotos, TXT e CSV. Preencha o valor.");
        applyParsed({});
        return;
      }
      const receipt = parseReceiptText(content);
      const hints = parseRegisterText(content, { accounts, categories, today: todayISO() });
      if (!receipt.value) toast.info("Não encontrei o total. Confira o valor.");
      applyParsed({ value: receipt.value, kind: "Despesa", date: receipt.date, categoryId: hints.categoryId, name: receipt.name });
    } catch {
      toast.error("Não consegui ler o arquivo. Preencha o valor.");
      applyParsed({});
    } finally {
      setOcrProgress(null);
    }
  };
  const button = "rounded-2xl px-4 py-3 font-medium transition active:scale-[.98]";
  const displayName = name.trim() || (kind === "Transferência" ? "Transferência" : selectedCategory?.name || kind);
  const close = () => (onClose ? onClose() : navigate(-1));
  /** What the user is typing, in Brazilian format ("1.234,5"), or the result when there is an operator. */
  const typedAmount = typedDisplay(expr);
  const clearTimer = useRef<number | null>(null);
  // Each key builds on the latest expression (fast typing never drops keys).
  const press = (key: string) => setExpr((current) => pressKey(current, key));
  const kindCategories = kind === "Receita"
    ? [...categories].sort((a, b) => Number(b.name.toLocaleLowerCase("pt-BR") === "renda") - Number(a.name.toLocaleLowerCase("pt-BR") === "renda"))
    : categories.filter((c) => c.name.toLocaleLowerCase("pt-BR") !== "renda");
  const dateLabel = (() => {
    if (date === todayISO()) return "Hoje";
    const d = new Date(`${date}T12:00:00`);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return d.toDateString() === yesterday.toDateString() ? "Ontem" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  })();
  const amountValue = Number(value) || 0;
  // "Repetir um lançamento recente": the last three different names of this type.
  const recentTemplates = useMemo(() => {
    const type = kind === "Despesa" ? "despesa" : kind === "Receita" ? "receita" : "transferencia";
    const seen = new Set<string>();
    return [...(habitsQuery.data ?? [])].filter((t) => t.type === type).sort((a, b) => (b.date + b.created_at).localeCompare(a.date + a.created_at))
      .filter((t) => { const k = t.name.toLocaleLowerCase("pt-BR"); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  }, [habitsQuery.data, kind]);
  const hint = amountValue <= 0 ? null : !account ? "Escolha a conta" : kind === "Transferência" ? (!destination || destination === account ? "Escolha a conta de destino" : null) : !category ? "Escolha a categoria" : null;
  useEffect(() => {
    if (kind !== "Despesa" && selectedCardId) { setSelectedCardId(null); setInstallments(1); setPayment(""); }
  }, [kind, selectedCardId]);
  useEffect(() => {
    const result = evaluateExpression(expr);
    setValue(result > 0 ? String(result) : "");
  }, [expr]);
  useEffect(() => {
    if (page !== "entry") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const map: Record<string, string> = { "+": "+", "-": "−", "*": "×", x: "×", "/": "÷", ",": ",", ".": ",", Backspace: "⌫" };
      const key = /^\d$/.test(event.key) ? event.key : map[event.key];
      if (event.key === "Escape" || event.key === "Delete") { event.preventDefault(); setExpr(""); return; }
      if (key) { event.preventDefault(); press(key); }
      else if (event.key === "Enter" && canSave && !saveMutation.isPending) { event.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // A saved lançamento is "dirty" only once something differs from what was saved.
  const signature = JSON.stringify([amountValue, name.trim(), kind, category, account, selectedCardId, destination, date, note.trim(), origin.trim(), recurring]);
  const savedSignature = useRef<string | null>(null);
  if (existing && savedSignature.current === null && accountsQuery.isSuccess && categoriesQuery.isSuccess) savedSignature.current = signature;
  const dirty = existing ? savedSignature.current !== null && signature !== savedSignature.current : amountValue > 0 || name.trim() !== "" || expr !== "";
  dirtyRef.current = dirty;
  const latest = useRef({ save });
  latest.current = { save };
  const view = done ? "success" : page === "entry" ? "entry" : "other";
  const saving = saveMutation.isPending;
  useEffect(() => {
    onController?.({ view, kind, dirty, canSave, saving, hint, expanded: Boolean(existing && expanded), save: () => latest.current.save() });
  }, [onController, view, kind, dirty, canSave, saving, hint, existing, expanded]);
  const toggleCalc = () => {
    const next = !calc;
    // Leaving the calculator keeps the result of what was typed instead of a half-built sum.
    if (!next && /[+−×÷]/.test(expr)) { const result = evaluateExpression(expr); setExpr(result > 0 ? String(result).replace(".", ",") : ""); }
    setCalc(next); setRegisterCalc(next);
  };
  const scopeSheet = existing && isSeries ? <SeriesScopeSheet open={scopeOpen} canEditAll={existing.status !== "pago" && existing.date >= todayISO()} otherFields={category !== (existing.category_id ?? "") || account !== existing.account_id || date !== existing.date}
    accent={kind === "Despesa" ? "#fb7185" : kind === "Receita" ? "#34d399" : "#c4b5fd"} onClose={() => setScopeOpen(false)} onPick={(scope) => { setScopeOpen(false); scopeRef.current = scope; save(); }} /> : null;
  const datePicker = <DatePickerSheet open={dateOpen} value={date} onChange={setDate} onClose={() => setDateOpen(false)} accent={kind === "Despesa" ? "#e11d48" : kind === "Receita" ? "#047857" : "#7c3aed"} />;
  if (done) {
    return <div className={embedded ? "h-full min-h-0 w-full" : "mx-auto h-[min(860px,calc(100dvh-8rem))] w-full max-w-md overflow-hidden rounded-[30px] border border-border bg-background shadow-2xl"}>
      <RegisterSuccess kind={done.kind} amount={done.amount} name={done.name} chips={done.chips} pending={saveStatus === "pending"}
        onAnother={(next) => { if (capture) { onClose?.(); return; } if (existing) { onClose?.(); window.setTimeout(() => openRegisterSheet({ kind: next }), 450); return; } setDone(null); resetForm(); setKind(next); }}
        onView={() => { const tx = done.transaction; if (embedded && onClose) onClose(); else { setDone(null); resetForm(); navigate("/transacoes"); } if (tx) window.setTimeout(() => dialogs.openTransactionDetail(tx), 120); }}
        onDone={() => { if (onClose) { onClose(); return; } setDone(null); resetForm(); }} />
    </div>;
  }
  // Quick entry, laid out as in the prototype: header, amount, name, tag, categories, ⋮ · wallet · date, keypad.
  if (page === "entry") {
    const ops = /[+−×÷]/.test(expr);
    const tone = PROTO_TONE[kind];
    const fromAccount = selectedAccount;
    const toAccount = accounts.find((a) => a.id === destination);
    const fromAfter = (fromAccount?.balance ?? 0) - amountValue;
    return <div className={embedded ? "relative flex h-full min-h-0 w-full flex-col gap-2.5 bg-background px-5 pb-4 pt-6 text-foreground" : "relative mx-auto flex h-[min(860px,calc(100dvh-8rem))] w-full max-w-md flex-col gap-2.5 overflow-hidden rounded-[36px] border border-border bg-background px-5 pb-4 pt-6 text-foreground shadow-2xl"} data-testid="quick-entry">
      {embedded ? null : <div className="absolute left-1/2 top-2 h-[5px] w-20 -translate-x-1/2 rounded-full bg-border" aria-hidden="true" />}
      {/* Header: calculator · type (icons, the chosen one named) · AI. */}
      {existing && expanded ? (
        // Receipt over the whole screen: only the way back and what this lançamento is.
        <motion.header className="flex h-12 shrink-0 items-center gap-2 pt-[max(0rem,calc(env(safe-area-inset-top)-1.5rem))] box-content" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <button type="button" onClick={collapseRecord} aria-label="Voltar ao registro" data-testid="record-collapse" className="grid size-12 shrink-0 place-items-center rounded-full border border-border bg-card"><ArrowLeft size={20} /></button>
          <button type="button" onClick={collapseRecord} className="flex h-12 min-w-0 flex-1 items-center justify-between gap-3 rounded-full bg-muted px-4 text-left" data-testid="record-summary">
            <span className="min-w-0 truncate text-[15px] font-bold">{name || "Sem nome"}</span>
            <span className={cn("shrink-0 text-[17px] font-bold tabular-nums", tone.text)}>{hidden ? "R$ ••••" : formatBRL(amountValue)}</span>
          </button>
        </motion.header>
      ) : <header className="flex h-10 shrink-0 items-center gap-2">
        {embedded ? null : <button type="button" onClick={close} aria-label="Fechar" className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card"><X size={18} /></button>}
        {desktop || !keypadOpen ? <div className="size-10 shrink-0" aria-hidden="true" /> : (
          <button type="button" onClick={toggleCalc} aria-pressed={calc} aria-label="Modo calculadora" data-testid="quick-entry-calc" className={cn("grid size-10 shrink-0 place-items-center rounded-full border border-[#a78bfa] transition-colors", calc ? "bg-[#7c3aed] text-white" : "bg-primary/10 text-[#a78bfa] dark:bg-[#17132e]")}><Calculator size={19} strokeWidth={1.8} aria-hidden="true" /></button>
        )}
        <div className="flex h-10 min-w-0 flex-1 items-center justify-between rounded-full border border-border bg-card px-[3px]" role="radiogroup" aria-label="Tipo">
          {(["Receita", "Despesa", "Transferência"] as Kind[]).map((k) => {
            const Icon = KIND_UI[k].icon;
            const active = kind === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={active} aria-label={k} disabled={(Boolean(capture) && k !== "Despesa") || Boolean(existing && (existing.invoice_payment || existing.invoice_refund || existing.installment) && KIND_OF(existing.type) !== k)} onClick={() => setKind(k)}
                className={cn("flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-bold transition-all", active ? cn("px-3", PROTO_TONE[k].chip) : "w-9 text-muted-foreground")}>
                <Icon size={16} aria-hidden="true" />{active ? <span>{k}</span> : null}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => go("start")} aria-label={MEDIA_INPUTS ? "Registro inteligente: escrever, falar ou fotografar" : "Registro inteligente: escrever como foi"} title="Registro inteligente" className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card text-[#a78bfa]"><Sparkles size={18} /></button>
      </header>}

      {(() => {
        const top = <>
      {/* Amount: big, in the type's colour, with a caret while typing; the sum above it in calculator mode. */}
      <button type="button" onClick={() => { if (swiped.current) { swiped.current = false; return; } setKeypadOpen(true); }} onPointerDown={(e) => { swipeStart.current = e.clientX; }} onPointerUp={(e) => { const dx = e.clientX - (swipeStart.current ?? e.clientX); swipeStart.current = null; if (existing && Math.abs(dx) > 70) { swiped.current = true; goSibling(dx < 0 ? 1 : -1); } }} aria-label="Valor: toque para digitar" className={cn("flex min-h-[60px] flex-col", existing && !keypadOpen ? "h-[88px] shrink-0" : "flex-1", " items-center justify-center gap-1", amountValue || ops ? tone.text : "text-[#5d5d75]")}>
        {ops && keypadOpen ? <span className="text-[17px] font-medium tabular-nums" aria-hidden="true">{expr.replace(/\./g, ",").replace(/\s*([+−×÷])\s*/g, " $1 ")}</span> : null}
        <span className={cn("flex items-center font-bold leading-none tracking-[-1px] tabular-nums", !keypadOpen ? (existing ? "text-[50px]" : "text-[64px]") : ops ? "text-[48px]" : "text-[56px]")}>
          <span data-testid="quick-entry-amount" aria-live="polite">{existing && hidden && !keypadOpen ? "R$ ••••" : typedAmount ?? formatBRL(amountValue).replace(/,00$/, "")}</span>
          {keypadOpen && !ops && !desktop ? <span className={cn("ml-1 h-[47px] w-[3px] animate-pulse rounded-sm", tone.caret)} aria-hidden="true" /> : null}
        </span>
        {!keypadOpen && existing && position >= 0 && siblings && siblings.length > 1 ? (
          <span className="flex items-center gap-3 text-[13px] text-muted-foreground" data-testid="record-siblings">
            <span role="button" tabIndex={0} aria-label="Lançamento anterior" aria-disabled={position === 0} onClick={(e) => { e.stopPropagation(); goSibling(-1); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); goSibling(-1); } }} className={cn("grid size-7 place-items-center rounded-full bg-muted", position === 0 && "opacity-30")}><ChevronLeft size={15} /></span>
            <span>Toque para editar · {position + 1} de {siblings.length}</span>
            <span role="button" tabIndex={0} aria-label="Próximo lançamento" aria-disabled={position === siblings.length - 1} onClick={(e) => { e.stopPropagation(); goSibling(1); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); goSibling(1); } }} className={cn("grid size-7 place-items-center rounded-full bg-muted", position === siblings.length - 1 && "opacity-30")}><ChevronRight size={15} /></span>
          </span>
        ) : !keypadOpen ? <span className="text-[13px] text-muted-foreground">{ops ? `${expr.replace(/\./g, ",").replace(/\s*([+−×÷])\s*/g, " $1 ")} · ` : ""}{existing ? "Toque para editar" : "toque para editar"}</span> : null}
      </button>

      {kind === "Transferência" ? (
        <div className="relative flex shrink-0 flex-col gap-2" data-testid="transfer-preview">
          {([["Sai de", fromAccount, () => go("pay"), "transfer-from", "bg-income/15 text-income dark:bg-[#0d2a22] dark:text-[#10b981]"], ["Vai para", toAccount, () => { setDestinationPicker(true); setInstitutionId(null); go("accounts"); }, "transfer-to", "bg-amber-500/15 text-amber-500 dark:bg-[#2a1a0c] dark:text-[#fb923c]"]] as const).map(([label, acc, pick, id, iconTone]) => (
            <button key={id} type="button" onClick={pick} data-testid={id} className="flex h-[52px] items-center gap-3 rounded-full bg-muted pl-2 pr-[18px] text-left">
              <span className={cn("grid size-[38px] shrink-0 place-items-center rounded-full", iconTone)}><Wallet size={18} aria-hidden="true" /></span>
              <span className="flex min-w-0 flex-1 flex-col leading-[1.15]"><span className="text-xs text-muted-foreground">{label}</span><span className="truncate text-base font-bold">{acc?.name ?? "Escolha uma conta"}</span></span>
              <ChevronRight size={18} className="text-[#a78bfa]" aria-hidden="true" />
              {id === "transfer-from" && acc ? <span className="sr-only" data-testid="transfer-from-after">{formatBRL(fromAfter)}</span> : null}
            </button>
          ))}
          {<button type="button" aria-label="Inverter origem e destino" data-testid="transfer-swap" onClick={() => { if (!destination) return; const from = account; setAccount(destination); setDestination(from); }} className="absolute left-1/2 top-1/2 z-10 grid size-[38px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-background bg-[#7c3aed] text-white"><ArrowLeftRight size={16} className="rotate-90" aria-hidden="true" /></button>}
        </div>
      ) : null}
      {kind === "Transferência" && fromAccount && amountValue > 0 && fromAfter < 0 ? <p className="shrink-0 text-xs text-expense" role="status" data-testid="transfer-negative">{fromAccount.name} fica negativa em {formatBRL(-fromAfter)} com esta transferência.</p> : null}

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Uber, mercado)" aria-label="Nome" onFocus={() => setKeypadOpen(false)} className="h-12 w-full shrink-0 rounded-full bg-muted px-5 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40" />

      <div className="flex h-[30px] shrink-0 items-center gap-2 text-[13px]">
        {originOpen ? (
          <input autoFocus value={origin} maxLength={40} onChange={(e) => setOrigin(e.target.value)} onBlur={() => window.setTimeout(() => setOriginOpen(false), 150)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setOriginOpen(false); } }} onFocus={() => setKeypadOpen(false)} aria-label="Origem" placeholder="Origem (ex.: Mercado Pago)" data-testid="quick-entry-origin-input"
            className="h-7 min-w-0 flex-1 rounded-full bg-primary/10 px-3 font-medium text-primary outline-none placeholder:text-primary/50 dark:bg-[#1d1640] dark:text-[#c4b5fd]" />
        ) : (
          <button type="button" onClick={() => { setKeypadOpen(false); setOriginOpen(true); }} aria-label="Editar origem" data-testid="quick-entry-origin" className="flex h-7 items-center gap-1.5 rounded-full bg-primary/10 px-3 font-medium text-primary dark:bg-[#1d1640] dark:text-[#c4b5fd]"><Tag size={13} aria-hidden="true" />{origin.trim() || (capture || existing?.capture ? "Apple Pay" : "Registro")}</button>
        )}
        {existing && !originOpen ? <button type="button" onClick={existing.status === "pago" ? undefined : () => void settle()} aria-label={existing.status === "pago" ? undefined : "Marcar como pago"} className={cn("flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-medium", existing.status === "pago" ? "bg-income/12 text-income dark:bg-[#0d2a22] dark:text-[#34d399]" : "bg-amber-500/12 text-amber-500")} data-testid="record-status"><Check size={13} aria-hidden="true" />{existing.status === "pago" ? (existing.type === "receita" ? "Recebido" : "Pago") : existing.status === "agendado" ? "Agendado" : "Pendente"}</button> : null}
        {existing && !originOpen && (existing.installment || existing.fixed || existing.invoice_payment || existing.invoice_refund) ? <span className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-sky-500/12 px-3 font-medium text-sky-500 dark:bg-[#0c2330] dark:text-[#38bdf8]" data-testid="record-kind">{existing.installment ? `Parcela ${existing.current_installment ?? 1}/${existing.total_installments ?? "?"}` : existing.invoice_payment ? "Fatura" : existing.invoice_refund ? "Estorno" : "Mensal"}</span> : null}
        {existing && dirty && !originOpen ? <span className="flex h-7 items-center gap-1.5 rounded-full bg-amber-500/12 px-3 font-medium text-amber-500 dark:bg-[#2a1a0c] dark:text-[#fb923c]" data-testid="record-changed"><Pencil size={12} aria-hidden="true" />Alterado</span> : null}
        {originOpen ? (origins.data ?? []).filter((o) => o.label.toLowerCase().includes(origin.trim().toLowerCase()) && o.label !== origin).slice(0, 3).map((o) => (
          <button key={o.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOrigin(o.label); setOriginOpen(false); }} className="shrink-0 rounded-full border border-border px-2.5 py-1 text-muted-foreground">{o.label}</button>
        )) : <button type="button" onClick={() => go("more")} className="shrink-0 whitespace-nowrap text-muted-foreground" data-testid="quick-entry-add-tag">{existing ? "+ tag" : "+ Adicionar tag"}</button>}
      </div>

      {kind !== "Transferência" ? (
        <div className="shrink-0 rounded-[22px] bg-card px-3 pb-2 pt-[7px]">
          <div ref={categoryStrip} className="relative -mx-1 flex items-center gap-2.5 overflow-x-auto scroll-smooth px-1 py-[3px] [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]" role="radiogroup" aria-label="Categoria">
            <button type="button" onClick={() => go("categories")} aria-label="Buscar categoria" className="grid size-11 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-[#3a3b6a] text-muted-foreground"><Search size={18} /></button>
            {kindCategories.map((c) => {
              const active = category === c.id;
              return (
                <button key={c.id} type="button" role="radio" aria-checked={active} aria-label={c.name} onClick={() => { setCategory(active ? "" : c.id); setKeypadOpen(false); }} className="grid size-11 shrink-0 place-items-center rounded-full transition-shadow" style={{ backgroundColor: `color-mix(in oklab, ${c.color} 16%, transparent)`, color: c.color, boxShadow: active ? `0 0 0 2px ${c.color}` : undefined }}>
                  <CategoryIcon name={c.icon} className="size-5" />
                </button>
              );
            })}
          </div>
          {existing && selectedCategory ? (
            // On a saved lançamento the name opens the category: its month, its history, its lançamentos.
            <button type="button" onClick={() => { onClose?.(); navigate(categoryFlowPath(selectedCategory.id, date.slice(0, 7), kind === "Receita" ? "receitas" : "despesas")); }} className="mx-auto mt-1.5 flex items-center gap-0.5 text-[15px] font-bold" style={{ color: `color-mix(in oklab, ${selectedCategory.color} 72%, white)` }} data-testid="quick-entry-category-name">
              {selectedCategory.name}<ChevronRight size={15} aria-hidden="true" />
            </button>
          ) : <p className={cn("mt-1.5 text-center", selectedCategory ? "text-[15px] font-bold" : "text-[13px] font-medium")} style={{ color: selectedCategory ? `color-mix(in oklab, ${selectedCategory.color} 72%, white)` : undefined }} data-testid="quick-entry-category-name">{selectedCategory?.name ?? <span className="text-muted-foreground">Sem categoria</span>}</p>}
        </div>
      ) : null}

        </>;
        if (!existing) return top;
        // A saved lançamento: scrolling the receipt folds the fields away so it gets the whole screen.
        return <motion.div className="-mx-1 -my-1 flex shrink-0 flex-col gap-2.5 overflow-hidden px-1 py-1" initial={false}
          animate={expanded ? { height: 0, opacity: 0, marginBottom: -10 } : { height: "auto", opacity: 1, marginBottom: 0 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }} aria-hidden={expanded}>{top}</motion.div>;
      })()}
      {existing && !keypadOpen ? (
        <div ref={recordScroll} onScroll={(e) => { const top = e.currentTarget.scrollTop; if (collapsing.current) { if (top <= 4) collapsing.current = false; return; } if (!expanded && top > 24) setExpanded(true); }} className={cn("-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1", expanded && "pb-24")} data-testid="record-scroll">
          <RecordInsight tx={existing} onDeleted={() => onClose?.()} onLeave={() => onClose?.()} onSettle={settle} settling={settling} onChanged={(u) => openRegisterSheet({ existing: u })} onRepeat={() => openRegisterSheet({ template: existing })} />
        </div>
      ) : null}

      {!existing && !keypadOpen && !desktop && recentTemplates.length > 0 ? (
        <div className="flex shrink-0 flex-col gap-1.5" data-testid="quick-entry-recent">
          <div className="flex h-[18px] items-center justify-between text-[13px] text-muted-foreground"><span>Repetir um lançamento recente</span></div>
          {recentTemplates.map((t) => (
            <button key={t.id} type="button" onClick={() => { setName(t.name); setExpr(String(t.value).replace(".", ",")); if (t.category_id) setCategory(t.category_id); }} className="flex h-10 items-center gap-2.5 rounded-full border border-border/70 bg-card pl-[5px] pr-3.5 text-sm">
              <span className="grid size-[30px] shrink-0 place-items-center rounded-full" style={{ backgroundColor: `color-mix(in oklab, ${t.category_color ?? "#64748B"} 16%, transparent)`, color: t.category_color ?? "#64748B" }}><CategoryIcon name={t.category_icon ?? "more-horizontal"} className="size-4" /></span>
              <span className="min-w-0 flex-1 truncate text-left font-medium">{t.name}</span>
              <span className="text-muted-foreground tabular-nums">{formatBRL(t.value)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* ⋮ · wallet · date */}
      <div className={cn("flex h-12 shrink-0 items-center gap-2", existing && expanded && "hidden")}>
        <button type="button" onClick={() => go("more")} aria-label="Mais opções" data-testid="quick-entry-more" className="grid size-12 shrink-0 place-items-center rounded-full border border-border bg-card"><MoreVertical size={20} /></button>
        {kind !== "Transferência" ? <button type="button" onClick={() => go("pay")} className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-muted px-1.5 text-left" data-testid="quick-entry-account">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", selectedCard ? "bg-primary/15 text-primary" : "bg-income/15 text-income dark:bg-[#0d2a22] dark:text-[#10b981]")}>{selectedCard ? <CreditCard size={17} /> : <Wallet size={17} />}</span>
          <span className="flex min-w-0 flex-col leading-[1.15]">
            <span className="truncate text-[15px] font-bold">{selectedCard ? selectedCard.name : selectedAccount?.name ?? "Escolher conta"}</span>
            {selectedCard ? <span className="text-xs text-muted-foreground">Crédito</span> : null}
          </span>
        </button> : null}
        <button type="button" onClick={() => { setKeypadOpen(false); setDateOpen(true); }} className={cn("h-12 shrink-0 rounded-full bg-muted px-5 text-[15px] font-bold", kind === "Transferência" && "flex-1")} data-testid="quick-entry-date">{dateLabel}</button>
      </div>

      {selectedCard && kind === "Despesa" && !existing ? (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]" role="radiogroup" aria-label="Parcelas" data-testid="quick-entry-installments">
          {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={installments === n} onClick={() => setInstallments(n)} className={cn("h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold tabular-nums transition-colors", installments === n ? "bg-primary text-primary-foreground" : "bg-muted")}>
              {n === 1 ? "À vista" : `${n}x`}
            </button>
          ))}
        </div>
      ) : null}

      {keypadOpen && !desktop ? <div className={cn("grid shrink-0 gap-2", calc ? "grid-cols-4" : "grid-cols-3")} data-testid="quick-entry-keypad">
        {(calc ? KEYS : KEYS.filter((key) => !OPS.includes(key))).map((key) => (
          <button key={key} type="button" onClick={() => press(key)} aria-label={key === "⌫" ? "Apagar (segure para limpar)" : key}
            onPointerDown={key === "⌫" ? () => { clearTimer.current = window.setTimeout(() => { setExpr(""); clearTimer.current = null; }, 550); } : undefined}
            onPointerUp={key === "⌫" ? () => { if (clearTimer.current) window.clearTimeout(clearTimer.current); } : undefined}
            onPointerLeave={key === "⌫" ? () => { if (clearTimer.current) window.clearTimeout(clearTimer.current); } : undefined}
            className={cn("h-[clamp(2.75rem,6.2dvh,3.25rem)] rounded-full font-medium transition-transform active:scale-95", OPS.includes(key) ? "bg-primary/10 text-[26px] text-primary dark:bg-[#1d1640] dark:text-[#c4b5fd]" : "bg-muted text-2xl")}>
            {key === "⌫" ? <Delete className="mx-auto" size={22} aria-hidden="true" /> : key}
          </button>
        ))}
      </div> : null}
      {/* In the sheet the floating button saves (✓ in the type's colour); the full page keeps its own button. */}
      {embedded ? null : <button type="button" onClick={save} disabled={saveMutation.isPending || !canSave} className={cn("h-12 w-full shrink-0 rounded-full text-base font-semibold transition-opacity disabled:opacity-40", KIND_THEME[kind].solid)} data-testid="quick-entry-save">
        {saveMutation.isPending ? "Salvando…" : hint ?? "Salvar"}
      </button>}
      {datePicker}
      {scopeSheet}
    </div>;
  }
  const pickRow = ({ key, selected, onClick, icon, iconClass, iconStyle, title, sub, testId }: { key: string; selected: boolean; onClick: () => void; icon: React.ReactNode; iconClass?: string; iconStyle?: React.CSSProperties; title: string; sub?: string; testId?: string }) => (
    <button key={key} type="button" onClick={onClick} data-testid={testId} aria-pressed={selected}
      className={cn("flex h-16 shrink-0 items-center gap-3 rounded-full border-[1.5px] pl-2.5 pr-4 text-left", selected ? "border-[#a78bfa] bg-primary/10 dark:bg-[#1d1640]" : "border-transparent bg-muted")}>
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", iconClass)} style={iconStyle}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col leading-[1.25]"><span className="truncate text-base font-bold">{title}</span>{sub ? <span className={cn("truncate text-[13px] tabular-nums", selected ? "text-primary dark:text-[#c4b5fd]" : "text-muted-foreground")}>{sub}</span> : null}</span>
      {selected ? <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-[#7c3aed] text-white"><Check size={15} aria-hidden="true" /></span> : <span className="size-[26px] shrink-0 rounded-full border-[1.5px] border-[#3a3b6a]" aria-hidden="true" />}
    </button>
  );
  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} type="button" onClick={onClick} aria-pressed={active} className={cn("h-9 shrink-0 rounded-full border px-4 text-sm", active ? "border-[#a78bfa] bg-primary/10 font-medium text-primary dark:bg-[#1d1640] dark:text-[#c4b5fd]" : "border-transparent bg-muted")}>{label}</button>
  );
  const toggleRow = (icon: React.ReactNode, label: string, val: string, onClick: () => void, divider: boolean) => (
    <button type="button" onClick={onClick} className={cn("flex h-12 items-center justify-between text-[15px]", divider && "border-b border-border/70")}>
      <span className="flex items-center gap-3">{icon}{label}</span><span className="flex items-center gap-1.5 font-medium text-[#a78bfa]">{val}<ChevronRight size={15} aria-hidden="true" /></span>
    </button>
  );
  const row = (label: string, val: string, action: () => void) => <button onClick={action} className="flex w-full items-center justify-between border-b border-border py-4 text-left text-sm"><span>{label}</span><span className="flex items-center gap-2 text-primary">{val}<ChevronRight size={15}/></span></button>;
  return <div className={embedded ? "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground" : "mx-auto flex min-h-[min(790px,90dvh)] w-full max-w-md flex-col overflow-hidden rounded-[30px] border border-border bg-background text-foreground shadow-2xl"}>
    {SUB_TITLES[page] ? (
      <header className="flex h-11 shrink-0 items-center gap-3 px-5 pt-6 pb-0 box-content">
        <button type="button" aria-label="Voltar" onClick={back} className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card"><ArrowLeft size={18} /></button>
        <h2 className="min-w-0 flex-1 truncate text-[21px] font-bold">{page === "accounts" && destinationPicker ? "Vai para" : SUB_TITLES[page]}</h2>
        {page === "pay" || page === "accounts" ? <button type="button" onClick={toggleHidden} aria-label="Mostrar ou ocultar saldos" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-background text-[#a78bfa]">{hidden ? <EyeOff size={18} /> : <Eye size={18} />}</button> : null}
      </header>
    ) : <header className="flex items-center gap-3 px-6 pt-7 pb-4"><div className="grid size-11 place-items-center rounded-2xl bg-primary/12 text-primary"><WandSparkles size={20}/></div><div className="flex-1"><div className="font-semibold">Registro inteligente</div><div className="text-xs text-muted-foreground">{MEDIA_INPUTS ? "Escreva, fale ou fotografe" : "Escreva como foi, em uma frase"}</div></div><button aria-label="Voltar" onClick={back} className="grid size-10 place-items-center rounded-full hover:bg-muted"><ArrowLeft size={20}/></button></header>}
    <main key={page} className={cn("min-h-0 flex-1 animate-in fade-in slide-in-from-bottom-3 overflow-y-auto overscroll-contain duration-300", SUB_TITLES[page] ? "px-5 pb-4 pt-3" : "px-6 py-5")}>
      {page === "start" && <><h1 className="mt-2 text-2xl font-semibold leading-tight">Como foi?</h1><div className="mt-5 flex flex-wrap gap-2">{["Café 9 reais no Pix", "Recebi 3100 de salário", "Uber 23 ontem"].map(t => <button key={t} onClick={() => interpret(t)} className="rounded-full border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted">{t}</button>)}</div></>}
      {page === "manual" && <><div className="text-center text-xs text-muted-foreground">REGISTRO MANUAL</div><div className="my-9 text-center text-5xl font-semibold">{format(value)}</div><input aria-label="Nome da movimentação" value={name} onChange={e => setName(e.target.value)} placeholder="Nome da movimentação" className="mb-8 w-full rounded-xl bg-muted p-4 text-center outline-none"/><div className="grid grid-cols-3 gap-2">{["1","2","3","4","5","6","7","8","9","C","0","⌫"].map(k => <button key={k} type="button" className="rounded-full bg-muted py-2.5 text-xl" onClick={() => setValue(v => { const cents = String(Math.round((Number(v) || 0) * 100)); const next = k === "C" ? "" : k === "⌫" ? cents.slice(0, -1) : cents.replace(/^0+/, "") + k; return (Number(next || "0") / 100).toFixed(2); })}>{k}</button>)}</div><button disabled={Number(value) <= 0} onClick={() => go("details")} className={button + " mt-4 w-full bg-primary text-primary-foreground disabled:opacity-40"}>Continuar</button></>}
      {(page === "details" || page === "review") && <><h2 className="mb-4 text-2xl font-semibold">{"Revisar lançamento"}</h2><div className="mb-6 text-center text-4xl font-semibold">{format(value)}</div><input aria-label="Nome" value={name} onChange={e => setName(e.target.value)} placeholder="Descrição (opcional)" className="mb-4 w-full rounded-xl bg-muted p-3 outline-none"/><div className="mb-3 flex gap-1">{(["Despesa","Receita","Transferência"] as Kind[]).map(k => <button key={k} onClick={() => setKind(k)} className={"flex-1 rounded-xl px-1 py-3 text-xs " + (kind === k ? "bg-primary text-primary-foreground" : "bg-muted")}>{k}</button>)}</div>{kind !== "Transferência" && <section className="mb-4"><div className="mb-3 text-sm font-semibold">Categoria</div>{categoriesQuery.isPending ? <p className="text-sm text-muted-foreground">Carregando categorias...</p> : categoriesQuery.isError ? <p role="alert" className="text-sm text-expense">Não foi possível carregar categorias. <button onClick={() => categoriesQuery.refetch()} className="underline">Tentar novamente</button></p> : <div className="grid grid-cols-5 gap-2">{visibleCategories.map(c => <button key={c.id} onClick={() => setCategory(c.id)} className="flex min-w-0 flex-col items-center gap-1"><span className={"grid size-12 place-items-center rounded-full " + (category === c.id ? "ring-2 ring-primary" : "")} style={{backgroundColor: c.color + "33",color:c.color}}><CategoryIcon name={c.icon} className="size-6"/></span><span className="w-full truncate text-center text-xs">{c.name}</span></button>)}<button onClick={() => go("categories")} className="flex flex-col items-center gap-1"><span className="grid size-12 place-items-center rounded-full bg-muted"><Plus size={22}/></span><span className="text-xs">Mais</span></button></div>}</section>}{row(kind === "Transferência" ? "Carteira de origem" : "Carteira", accountLabel, () => {setDestinationPicker(false);setInstitutionId(null);go("accounts")})}{kind === "Transferência" && row("Conta de destino", accounts.find(a => a.id === destination)?.name || "Selecionar", () => {setDestinationPicker(true);setInstitutionId(null);go("accounts")})}{kind === "Despesa" && selectedCard && row("Parcelamento", installments+"x", () => go("installments"))}{row("Mais opções", "Data, nota e anexos", () => go("more"))}{!canSave && <p role="status" className="mt-4 text-sm text-amber-600 dark:text-amber-300">{Number(value) <= 0 ? "Informe um valor maior que zero." : !account ? "Selecione uma conta ou cartão na Carteira." : kind === "Transferência" && (!destination || destination === account) ? "Selecione uma carteira de destino diferente da origem." : !category ? "Escolha uma categoria." : "Escolha uma categoria de despesa ou altere o tipo para Receita."}</p>}<button onClick={save} disabled={saveMutation.isPending || !canSave} className={button + " mt-7 w-full bg-primary text-primary-foreground disabled:opacity-40"}>{saveMutation.isPending ? "Salvando..." : "Salvar movimentação"}</button></>}
      {page === "accounts" && !destinationPicker && <>{accountsQuery.isPending || cardsQuery.isPending ? <p className="text-sm text-muted-foreground">Carregando sua carteira...</p> : accountsQuery.isError || cardsQuery.isError ? <p role="alert" className="text-expense">Não foi possível carregar sua carteira. <button onClick={() => {accountsQuery.refetch();cardsQuery.refetch()}} className="underline">Tentar novamente</button></p> : <>{!institutionId || destinationPicker ? <><p className="mb-4 text-sm text-muted-foreground">Selecione a instituição ou conta cadastrada.</p><div className="grid grid-cols-2 gap-3">{accounts.map(a => <button key={a.id} onClick={() => {if(destinationPicker){setDestination(a.id);back()}else setInstitutionId(a.id)}} className={"flex min-h-28 flex-col items-start justify-center gap-2 rounded-2xl border p-4 text-left " + ((destinationPicker ? destination === a.id : institutionId === a.id) ? "border-primary bg-primary/10" : "border-border bg-muted")}><Landmark size={24} className="text-primary"/><span className="text-sm font-medium">{a.name}</span></button>)}</div>{accounts.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Nenhuma instituição ou conta cadastrada.</p>}</> : <><button onClick={() => setInstitutionId(null)} className="mb-5 flex items-center gap-2 text-sm text-primary"><ArrowLeft size={16}/>Trocar instituição</button><h3 className="mb-2 font-semibold">{accounts.find(a => a.id === institutionId)?.name}</h3><p className="mb-4 text-sm text-muted-foreground">Escolha como esta movimentação foi realizada.</p>{paymentsLoading && <p className="mb-3 text-sm text-muted-foreground">Carregando formas de pagamento...</p>}{paymentsError && <p role="alert" className="mb-3 text-sm text-expense">Não foi possível consultar as formas de pagamento desta conta.</p>}<div className="grid grid-cols-2 gap-3">{availablePayments.filter(p => kind !== "Receita" || p !== "Débito").map(p => <button key={p} onClick={() => {setAccount(institutionId);setSelectedCardId(null);setPayment(p);setInstallments(1);setInstitutionId(null);back()}} className={"flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left text-sm " + (account === institutionId && !selectedCardId && payment === p ? "border-primary bg-primary/10" : "border-border bg-muted")}><Wallet size={21} className="text-primary"/>{p}</button>)}{kind === "Despesa" && cardsForAccount(institutionId).map(c => <button key={c.id} onClick={() => {setAccount(institutionId);setSelectedCardId(c.id);setPayment("Crédito");setInstallments(1);setInstitutionId(null);back()}} className={"flex min-h-24 flex-col items-start justify-center gap-2 rounded-2xl border p-4 text-left text-sm " + (selectedCardId === c.id ? "border-primary bg-primary/10" : "border-border bg-muted")}><CreditCard size={22} className="text-primary"/><span>{c.name}</span><span className="text-xs text-muted-foreground">Crédito</span></button>)}</div>{kind === "Despesa" && cardsForAccount(institutionId).length === 0 && <p className="mt-4 text-xs text-muted-foreground">Nenhum cartão de crédito vinculado a esta conta.</p>}</>}</>}</>}
      {page === "installments" && <><h2 className="mb-6 text-xl font-semibold">Parcelamento</h2><div className="grid grid-cols-4 gap-2">{[1,2,3,4,5,6,10,12].map(n => <button key={n} onClick={() => setInstallments(n)} className={"rounded-xl p-3 " + (installments === n ? "bg-primary text-primary-foreground" : "bg-muted")}>{n}x</button>)}</div><p className="my-8 text-muted-foreground">Valor por parcela: {format(String(Number(value || 0) / installments))}</p><button onClick={back} className={button + " w-full bg-primary text-primary-foreground"}>Concluir</button></>}
      {page === "categories" && <div className="flex flex-col gap-2">
        <input value={categorySearch} onChange={e => setCategorySearch(e.target.value)} placeholder="Buscar categoria" aria-label="Buscar categoria" className="mb-1 h-12 w-full rounded-full bg-muted px-5 text-base outline-none placeholder:text-muted-foreground" />
        {categoriesQuery.isError ? <p role="alert">Erro ao carregar categorias. <button onClick={() => categoriesQuery.refetch()}>Tentar novamente</button></p> : kindCategories.filter(c => c.name.toLowerCase().includes(categorySearch.toLowerCase())).map(c => pickRow({ key: c.id, selected: category === c.id, onClick: () => { setCategory(c.id); back(); }, icon: <CategoryIcon name={c.icon} className="size-5" />, iconStyle: { backgroundColor: `color-mix(in oklab, ${c.color} 16%, transparent)`, color: c.color }, title: c.name }))}
        {!categoriesQuery.isPending && !categoriesQuery.isError && categories.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>}
        <button type="button" onClick={() => dialogs.openCategory()} data-testid="register-new-category" className="mt-1 h-[52px] shrink-0 rounded-full border-[1.5px] border-dashed border-[#3a3b6a] text-[15px] font-medium text-primary dark:text-[#c4b5fd]">+ Nova categoria</button>
      </div>}
      {(page === "pay" || (page === "accounts" && destinationPicker)) && <div className="flex flex-col gap-2">
        <p className="mt-0.5 text-[13px] text-muted-foreground">Contas e dinheiro</p>
        {accounts.filter(a => page === "pay" || a.id !== account).map(a => {
          const selected = page === "pay" ? account === a.id && !selectedCardId : destination === a.id;
          return pickRow({ key: a.id, selected, testId: "pay-account-" + a.id, onClick: () => { if (page === "pay") { setAccount(a.id); setSelectedCardId(null); setInstallments(1); setPayment(""); } else setDestination(a.id); back(); }, icon: <Wallet size={20} />, iconClass: WALLET_TONES[accounts.indexOf(a) % WALLET_TONES.length], title: a.name, sub: hidden ? "R$ ••••" : formatBRL(a.balance) });
        })}
        {page === "pay" && kind === "Despesa" ? <>
          <p className="mt-2 text-[13px] text-muted-foreground">Cartões de crédito</p>
          {cards.length === 0 ? <p className="rounded-full border-[1.5px] border-dashed border-[#3a3b6a] px-5 py-3.5 text-sm text-muted-foreground">Nenhum cartão cadastrado.</p> : cards.map(c => pickRow({ key: c.id, selected: selectedCardId === c.id, testId: "pay-card-" + c.id, onClick: () => { setSelectedCardId(c.id); setAccount(c.payment_account_id ?? accounts[0]?.id ?? ""); setPayment("Crédito"); back(); }, icon: <CreditCard size={20} />, iconClass: "bg-primary/15 text-primary dark:bg-[#1d1640] dark:text-[#a78bfa]", title: c.name, sub: hidden ? "Disponível R$ ••••" : `Disponível ${formatBRL(c.available)} · fecha dia ${c.closing_day}` }))}
        </> : null}
        <button type="button" onClick={() => dialogs.openAccount()} data-testid="register-new-wallet" className="mt-1 h-[52px] shrink-0 rounded-full border-[1.5px] border-dashed border-[#3a3b6a] text-[15px] font-medium text-primary dark:text-[#c4b5fd]">+ Nova carteira</button>
      </div>}
      {page === "more" && <div className="flex min-h-full flex-col gap-2.5">
        <section className={MORE_CARD + " px-4 py-3"}>
          <div className="mb-2 flex items-center justify-between text-[15px]"><span className="font-bold">Data</span><span className="text-sm text-[#a78bfa]">{new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}</span></div>
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {chip("Hoje", date === todayISO(), () => setDate(todayISO()))}
            {chip("Ontem", date === addDays(todayISO(), -1), () => setDate(addDays(todayISO(), -1)))}
            {chip("Outra data", date !== todayISO() && date !== addDays(todayISO(), -1), () => setDateOpen(true))}
          </div>
        </section>
        {kind !== "Transferência" ? <section className={MORE_CARD + " px-4 py-3"}>
          <div className="mb-2 text-[15px] font-bold">Forma de pagamento</div>
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {(["Pix", "Débito", "Crédito", "Dinheiro", "Boleto"] as const).filter(m => kind !== "Receita" || (m !== "Débito" && m !== "Crédito")).map(m => chip(m, m === "Crédito" ? Boolean(selectedCard) : !selectedCard && payment === m, () => {
              if (m === "Crédito") { go("pay"); return; }
              setSelectedCardId(null); setInstallments(1); setPayment(payment === m ? "" : m);
            }))}
          </div>
        </section> : null}
        <section className={MORE_CARD + " flex flex-col px-4"}>
          {toggleRow(<Repeat2 size={18} />, "Recorrência", recurring ? "Mensal" : "Não", () => setRecurring(!recurring), true)}
          {toggleRow(<Bell size={18} />, "Lembrete", reminder ? "Sim" : "Não", () => setReminder(!reminder), false)}
        </section>
        <div className="flex gap-2.5">
          <label className={MORE_CARD + " flex h-24 min-w-0 flex-1 flex-col gap-1.5 px-3.5 py-3"}>
            <span className="flex items-center gap-2 text-[15px] font-bold"><StickyNote size={16} aria-hidden="true" />Nota</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Opcional" aria-label="Nota" className="min-h-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </label>
          <label className="flex h-24 min-w-0 flex-1 cursor-pointer flex-col items-start justify-between rounded-[20px] border-[1.5px] border-dashed border-[#3a3b6a] bg-card px-3.5 py-3">
            <span className="flex items-center gap-2 text-[15px] font-bold"><Paperclip size={16} aria-hidden="true" />Anexos</span>
            <span className="max-w-full truncate text-sm font-medium text-primary dark:text-[#c4b5fd]">{attachment || "+ Foto ou arquivo"}</span>
            <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0] ?? null; e.target.value = ""; if (!f) return; setAttachment(f.name); if (existing) { void addTransactionPhoto(existing, f).then((u) => { toast.success("Foto do comprovante salva."); openRegisterSheet({ existing: u }); }).catch((err: Error) => toast.error(err.message || "Não foi possível salvar a foto.")); } else setPhotoFile(f); }} className="sr-only" />
          </label>
        </div>
        <section className={MORE_CARD + " flex flex-col px-4"}>
          <button type="button" onClick={() => { back(); setOriginOpen(true); }} className="flex h-12 items-center justify-between text-[15px]">
            <span className="flex items-center gap-3"><Tag size={18} aria-hidden="true" />Origem</span>
            <span className="flex h-7 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-[13px] font-medium text-primary dark:bg-[#1d1640] dark:text-[#c4b5fd]">{origin.trim() || (capture ? "Apple Pay" : "Registro")}<ChevronRight size={14} aria-hidden="true" /></span>
          </button>
        </section>
        <button type="button" onClick={back} className="mt-auto h-12 shrink-0 rounded-full bg-[#7c3aed] text-base font-bold text-white">Concluir</button>
      </div>}
      {page === "voice" && <div className="flex h-full flex-col items-center justify-center pb-10 text-center"><button type="button" onClick={listening ? stopVoice : startVoice} aria-label={listening ? "Parar" : "Falar"} className={"grid size-24 place-items-center rounded-full transition-colors " + (listening ? "bg-primary text-primary-foreground" : "bg-muted text-primary")}>{listening ? <Square size={30}/> : <Mic size={40}/>}</button>{listening ? <span className="mt-3 h-1 w-16 animate-pulse rounded-full bg-primary/60" aria-hidden="true"/> : null}<p className="mt-6 min-h-12 max-w-xs text-lg">{text || <span className="text-muted-foreground">{listening ? "Pode falar…" : "Toque e diga, por exemplo, “Paguei 45 no Uber”"}</span>}</p></div>}
      {page === "recognized" && recognized && recognized.proposal.kind === "register" ? <div data-testid="register-recognized">
        <h2 className="text-center text-xl font-semibold">Entendi <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-sm text-primary-foreground">{recognized.proposal.entries.length}</span></h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">“{recognized.heard}”</p>
        <ProposalCard proposal={recognized.proposal} state={recognized.state} categories={categories} accounts={accounts}
          onChange={(proposal) => setRecognized((r) => (r ? { ...r, proposal } : r))}
          onCancel={() => { setRecognized(null); back(); }}
          onApply={async () => { const state = await applyProposal(recognized.proposal); setRecognized((r) => (r ? { ...r, state } : r)); await queryClient.invalidateQueries(); }}
          onUndo={async () => { if (recognized.state.status !== "applied") return; await undoProposal(recognized.state); setRecognized((r) => (r ? { ...r, state: { status: "undone" } } : r)); await queryClient.invalidateQueries(); }} />
        {recognized.proposal.unknown.length ? <p className="mt-3 text-center text-xs text-muted-foreground" data-testid="register-unknown">Não usei: {recognized.proposal.unknown.map((u) => `“${u}”`).join(", ")}</p> : null}
        {recognized.state.status === "pending" && recognized.proposal.entries.length === 1 ? (
          <button type="button" onClick={() => openInForm((recognized.proposal as Extract<Proposal, { kind: "register" }>).entries[0])} className="mt-3 w-full text-center text-sm font-semibold text-primary">Abrir no formulário completo</button>
        ) : null}
        {recognized.state.status === "applied" || recognized.state.status === "undone" ? (
          <button type="button" onClick={() => { setRecognized(null); setText(""); setHistory([]); setPage("entry"); onClose?.(); }} className={button + " mt-4 w-full bg-primary text-primary-foreground"} data-testid="register-recognized-done">Concluir</button>
        ) : null}
      </div> : null}
      {page === "receipt" && <div className="flex h-full flex-col items-center justify-center pb-10 text-center"><ReceiptText size={44} className="text-primary motion-safe:animate-pulse"/><p className="mt-5 font-medium">Lendo o recibo…</p><div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${ocrProgress ?? 5}%` }}/></div>{attachment ? <p className="mt-3 max-w-xs truncate text-xs text-muted-foreground">{attachment}</p> : null}</div>}
      {page === "done" && <div className="py-10 text-center"><div className="mx-auto grid size-28 place-items-center rounded-full border-2 border-primary text-primary"><Check size={60}/></div><h2 className="mt-8 text-2xl">{saveStatus === "pending" ? "Salvo neste dispositivo" : "Registro realizado!"}</h2><p className="mt-5 text-3xl">{format(value)}</p><p className="mt-2 text-muted-foreground">{displayName}</p><p className="mt-8 text-sm text-muted-foreground">{saveStatus === "pending" ? "Aguardando conexão para sincronizar. Não apague os dados do aplicativo enquanto houver registros pendentes." : "Movimentação sincronizada com o FINNOS."}</p><button onClick={() => {setText("");setName("");setValue("");setSaveStatus(null);setExpr("");setPage("entry")}} className={button + " mt-8 w-full bg-primary text-primary-foreground"}>Novo registro</button></div>}
    </main>
    {page === "start" && <div className="mx-4 mb-3 shrink-0 rounded-3xl bg-muted p-3"><textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); interpret(); } }} placeholder="Ex.: Paguei R$ 45 no Uber com o Nubank ontem" className="h-16 w-full resize-none bg-transparent p-2 text-base outline-none"/><div className="flex items-center gap-1">{MEDIA_INPUTS ? <><button type="button" aria-label="Fotografar recibo" onClick={() => cameraInput.current?.click()} className="grid size-11 place-items-center rounded-full hover:bg-background/60"><Camera size={21}/></button><button type="button" aria-label="Falar" onClick={() => { go("voice"); startVoice(); }} className="grid size-11 place-items-center rounded-full hover:bg-background/60"><Mic size={21}/></button><button type="button" aria-label="Anexar arquivo" onClick={() => fileInput.current?.click()} className="grid size-11 place-items-center rounded-full hover:bg-background/60"><Paperclip size={21}/></button></> : <span className="px-2 text-xs text-muted-foreground">Voz, foto e anexo chegam em breve.</span>}<button type="button" aria-label="Interpretar" disabled={!text.trim()} onClick={() => interpret()} className="ml-auto grid size-11 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"><ArrowUp size={21}/></button></div></div>}
    <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { go("receipt"); void readFile(f); } }}/>
    <input ref={fileInput} type="file" accept="image/*,.txt,.csv,text/plain,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { go("receipt"); void readFile(f); } }}/>
    {!embedded && <footer className="pb-3 text-center text-xs text-muted-foreground">FINNOS · Registro de movimentações</footer>}
    {datePicker}
  </div>;
}

interface SpeechLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
