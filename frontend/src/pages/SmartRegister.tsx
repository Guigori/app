import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { parseReceiptText, parseRegisterText } from "@/lib/registerParsing";
import { getRegisterDefault } from "@/lib/registerPreferences";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TransactionInput } from "@/types/finnos";
import { createTransaction, fetchAccounts, fetchCards, fetchCategories } from "@/lib/data";
import { getAccountPaymentMethods } from "@/lib/accountPaymentPreferences";
import { formatBRL, isISODate, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { ArrowLeft, ArrowUp, Camera, Check, ChevronRight, Mic, Paperclip, Plus, X, Wallet, CreditCard, Landmark, CalendarDays, Repeat2, StickyNote, Bell, Tag, FolderOpen, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Delete, MoreVertical, Search, Ban, WandSparkles, ReceiptText, Square } from "lucide-react";

type Page = "entry" | "pay" | "start" | "manual" | "details" | "categories" | "accounts" | "installments" | "more" | "voice" | "receipt" | "review" | "done";
type Kind = "Despesa" | "Receita" | "Transferência";
const format = (n: string) => (Number(n || 0) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const OPS = ["+", "−", "×", "÷"];
/** Calculator keypad: evaluates "12,50+3×2" with × ÷ before + −; a trailing operator is ignored. */
function evaluateExpression(expr: string): number {
  const tokens = expr.match(/\d+(?:,\d*)?|[+−×÷]/g) ?? [];
  const nums: number[] = [];
  const ops: string[] = [];
  for (const t of tokens) {
    if (OPS.includes(t)) ops.push(t);
    else nums.push(Number(t.replace(",", ".")));
  }
  ops.length = Math.max(0, Math.min(ops.length, nums.length - 1));
  const terms = [nums[0] ?? 0];
  const signs: string[] = [];
  ops.forEach((op, i) => {
    const b = nums[i + 1];
    if (op === "×") terms[terms.length - 1] *= b;
    else if (op === "÷") terms[terms.length - 1] = b ? terms[terms.length - 1] / b : 0;
    else { signs.push(op); terms.push(b); }
  });
  const result = signs.reduce((acc, op, i) => (op === "+" ? acc + terms[i + 1] : acc - terms[i + 1]), terms[0]);
  return Math.round(result * 100) / 100;
}
const KEYS = ["1", "2", "3", "+", "4", "5", "6", "−", "7", "8", "9", "×", ",", "0", "⌫", "÷"];
const KIND_UI: Record<Kind, { icon: typeof ArrowDownLeft; tint: string; amount: string }> = {
  Receita: { icon: ArrowDownLeft, tint: "bg-income/12 text-income", amount: "text-income" },
  Despesa: { icon: ArrowUpRight, tint: "bg-expense/12 text-expense", amount: "text-foreground" },
  "Transferência": { icon: ArrowLeftRight, tint: "bg-primary/12 text-primary", amount: "text-foreground" },
};
export default function SmartRegister({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void }) {
  const navigate = useNavigate();
  const { hidden } = useBalanceHidden();
  const dateInput = useRef<HTMLInputElement>(null);
  const [expr, setExpr] = useState("");
  const [saved, setSaved] = useState(false);
  const [listening, setListening] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<{ stop: () => void } | null>(null);
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const categories = categoriesQuery.data ?? [];
  const accounts = (accountsQuery.data ?? []).filter(a => a.active);
  const cards = (cardsQuery.data ?? []).filter(c => c.active);
  const cardsForAccount = (accountId: string) => cards.filter(c => c.payment_account_id === accountId || (!c.payment_account_id && (!c.institution || c.institution.toLocaleLowerCase("pt-BR") === accounts.find(a => a.id === accountId)?.institution?.toLocaleLowerCase("pt-BR"))));
  const [paymentPreferencesVersion, setPaymentPreferencesVersion] = useState(0);
  const [availablePayments, setAvailablePayments] = useState<string[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState(false);
  useEffect(() => { const listener = () => setPaymentPreferencesVersion(v => v + 1); window.addEventListener("finnos:payment-methods-changed", listener); return () => window.removeEventListener("finnos:payment-methods-changed", listener); }, []);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  useEffect(() => {
    const selected = accounts.find(a => a.id === institutionId);
    if (!selected) { setAvailablePayments([]); return; }
    let cancelled = false;
    setPaymentsLoading(true); setPaymentsError(false); setAvailablePayments([]);
    getAccountPaymentMethods(selected).then(methods => { if (!cancelled) setAvailablePayments(methods); }).catch(() => { if (!cancelled) setPaymentsError(true); }).finally(() => { if (!cancelled) setPaymentsLoading(false); });
    return () => { cancelled = true; };
  }, [institutionId, paymentPreferencesVersion, accountsQuery.data]);
  const selectedCard = cards.find(c => c.id === selectedCardId);
  // Opens on the screen chosen in Configurações → Novo registro.
  const [page, setPage] = useState<Page>(() => (getRegisterDefault() === "inteligente" ? "start" : "entry"));
  const [history, setHistory] = useState<Page[]>([]);
  const [text, setText] = useState("");
  const [value, setValue] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("Despesa");
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState("");
  const selectedAccount = accounts.find(a => a.id === account);
  const [destination, setDestination] = useState("");
  const [installments, setInstallments] = useState(1);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [attachment, setAttachment] = useState("");
  const [destinationPicker, setDestinationPicker] = useState(false);
  const [payment, setPayment] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [saveStatus, setSaveStatus] = useState<"synced" | "pending" | null>(null);
  const refreshFinancialData = async () => { await Promise.all(["transactions", "accounts", "dashboard", "cards", "categories", "flow", "calendar"].map(key => queryClient.invalidateQueries({ queryKey: [key] }))); };
  const saveMutation = useMutation({ mutationFn: (input: TransactionInput) => createTransaction(input, "manual"), onSuccess: async () => { setSaveStatus("synced"); await refreshFinancialData(); finishSave(); }, onError: async (error: Error) => { if (error.message.includes("FINNOS_OFFLINE_QUEUED")) { setSaveStatus("pending"); await refreshFinancialData(); finishSave(); toast.info("Registro salvo neste dispositivo. Sincronização pendente."); return; } toast.error("Não foi possível salvar. O registro não foi confirmado; tente novamente."); } });
  const save = () => {
    if (!canSave) return;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || !account || !isISODate(date) || (kind !== "Transferência" && !category) || (kind === "Transferência" && (!destination || destination === account))) return;
    const input: TransactionInput = { name: displayName, value: amount, type: kind === "Despesa" ? "despesa" : kind === "Receita" ? "receita" : "transferencia", status: "pago", date, account_id: account, card_id: kind === "Despesa" ? selectedCardId : null, to_account_id: kind === "Transferência" ? destination : null, category_id: kind === "Transferência" ? null : category, fixed: recurring, recurrence: recurring ? "mensal" : null, installment: kind === "Despesa" && !!selectedCardId && installments > 1, total_installments: kind === "Despesa" && !!selectedCardId && installments > 1 ? installments : null, current_installment: kind === "Despesa" && !!selectedCardId && installments > 1 ? 1 : null, adjusted_value: null, attachment: null, notes: [note.trim(), payment && kind !== "Transferência" ? `Forma de pagamento: ${payment}` : "", project.trim() ? `Projeto: ${project.trim()}` : "", tags.trim() ? `Tags: ${tags.trim()}` : ""].filter(Boolean).join("\n") || null, notify_enabled: reminder };
    saveMutation.mutate(input);
  };
  
  useEffect(() => { if (category && !categories.some(c => c.id === category)) setCategory(""); }, [categoriesQuery.data, category]);
  useEffect(() => { if (account && !accounts.some(a => a.id === account)) setAccount(""); }, [accountsQuery.data, account]);
  // A single wallet is the obvious default; with several, the first one (changeable in the chip).
  useEffect(() => { if (!account && accounts.length > 0) setAccount(accounts[0].id); }, [accountsQuery.data, account]);
  useEffect(() => { if (selectedCardId && !cards.some(c => c.id === selectedCardId)) setSelectedCardId(null); }, [cardsQuery.data, selectedCardId]);
  const selectedCategory = categories.find(c => c.id === category);
  const visibleCategories = selectedCategory && !categories.slice(0, 4).some(c => c.id === selectedCategory.id) ? [...categories.slice(0, 3), selectedCategory] : categories.slice(0, 4);
  const canSave = Number(value) > 0 && !!account && (kind === "Transferência" ? !!destination && destination !== account : !!category && !(kind === "Despesa" && selectedCategory?.name.toLocaleLowerCase("pt-BR") === "renda"));
  const accountLabel = selectedCard ? `${selectedCard.name} · Crédito` : selectedAccount ? [selectedAccount.name, payment].filter(Boolean).join(" · ") : "Selecionar";
  const [reminder, setReminder] = useState(false);
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");
  const go = (p: Page) => { setHistory(h => [...h, page]); setPage(p); };
  const back = () => { setPage(history.at(-1) || "entry"); setHistory(h => h.slice(0, -1)); };
  // A short check mark, then the sheet closes (or a fresh entry on the full page).
  const finishSave = () => {
    setSaved(true);
    window.setTimeout(() => {
      setSaved(false);
      setExpr(""); setValue(""); setName(""); setNote(""); setCategory(""); setAttachment(""); setText("");
      setHistory([]); setPage("entry");
      onClose?.();
    }, 850);
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
  const interpret = (source = text) => {
    if (!source.trim()) return;
    applyParsed(parseRegisterText(source, { accounts, categories, today: todayISO() }));
  };
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
  const typedAmount = (() => {
    if (!expr || /[+−×÷]/.test(expr)) return null;
    const [int, dec] = expr.split(",");
    const intPart = Number(int || "0").toLocaleString("pt-BR");
    return `R$ ${intPart}${dec !== undefined ? `,${dec}` : ""}`;
  })();
  const clearTimer = useRef<number | null>(null);
  // Each key builds on the latest expression (fast typing never drops keys).
  const press = (key: string) => setExpr((current) => {
    const lastNumber = current.split(/[+−×÷]/).at(-1) ?? "";
    if (key === "⌫") return current.slice(0, -1);
    if (OPS.includes(key)) return !current ? current : OPS.includes(current.at(-1) ?? "") ? current.slice(0, -1) + key : current + key;
    if (key === ",") return lastNumber.includes(",") ? current : current + (lastNumber ? "," : "0,");
    if (lastNumber.includes(",") && lastNumber.split(",")[1].length >= 2) return current;
    if (lastNumber.replace(",", "").length >= 9) return current;
    return lastNumber === "0" ? current.slice(0, -1) + key : current + key;
  });
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
  // Quick entry: amount, account, date, note, category and a calculator keypad on one screen.
  if (page === "entry") {
    return <div className={embedded ? "relative flex h-full min-h-0 w-full flex-col bg-background text-foreground" : "relative mx-auto flex h-[min(860px,calc(100dvh-8rem))] w-full max-w-md flex-col overflow-hidden rounded-[30px] border border-border bg-background text-foreground shadow-2xl"} data-testid="quick-entry">
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3">
        {embedded ? <span className="size-11 shrink-0" aria-hidden="true" /> : <button type="button" onClick={close} aria-label="Fechar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><X size={20} /></button>}
        <div className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1" role="radiogroup" aria-label="Tipo">
          {(["Receita", "Despesa", "Transferência"] as Kind[]).map((k) => {
            const Icon = KIND_UI[k].icon;
            const active = kind === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={active} aria-label={k} onClick={() => setKind(k)} className={cn("flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition-all", active ? KIND_UI[k].tint : "text-muted-foreground")}>
                <Icon size={17} aria-hidden="true" />{active ? <span>{k === "Transferência" ? "Transferir" : k}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center">
          <button type="button" onClick={() => go("start")} aria-label="Registro inteligente: escrever, falar ou fotografar" title="Registro inteligente" className="grid size-11 place-items-center rounded-full text-primary hover:bg-muted"><WandSparkles size={20} /></button>
          <button type="button" onClick={() => go("more")} aria-label="Mais opções" className="grid size-11 place-items-center rounded-full border border-border bg-card"><MoreVertical size={20} /></button>
        </div>
      </header>

      <AnimatePresence>
        {saved ? (
          <motion.div key="saved" className="absolute inset-0 z-10 grid place-items-center bg-background/80 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} role="status" aria-live="polite">
            <motion.div className="flex flex-col items-center gap-3" initial={{ scale: 0.85, y: 6 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 26 }}>
              <span className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground">
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.08, ease: "easeOut" }} /></svg>
              </span>
              <span className="text-sm font-medium">{saveStatus === "pending" ? "Salvo no aparelho" : "Salvo"}</span>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="flex min-h-20 flex-1 flex-col items-center justify-center px-4">
        <p className="h-5 text-sm tabular-nums text-muted-foreground" aria-hidden="true">{/[+−×÷]/.test(expr) ? expr : ""}</p>
        <p className={cn("font-heading text-[clamp(2.75rem,15vw,4.5rem)] font-bold leading-none tracking-tight tabular-nums", amountValue ? KIND_UI[kind].amount : "text-muted-foreground/50")} data-testid="quick-entry-amount" aria-live="polite">
          {typedAmount ?? formatBRL(amountValue).replace(/,00$/, "")}
        </p>
      </div>

      <div className="shrink-0 space-y-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go("pay")} className="flex min-w-0 items-center gap-2 rounded-full bg-muted py-1.5 pl-1.5 pr-4 text-left" data-testid="quick-entry-account">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", selectedCard ? "bg-primary/15 text-primary" : "bg-income/15 text-income")}>{selectedCard ? <CreditCard size={18} /> : <Wallet size={18} />}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{selectedCard ? selectedCard.name : selectedAccount?.name ?? "Escolher conta"}</span>
              {selectedCard ? <span className="block text-xs text-muted-foreground">Crédito · {hidden ? "••••" : `disp. ${formatBRL(selectedCard.available)}`}</span> : selectedAccount ? <span className="block text-xs tabular-nums text-muted-foreground">{hidden ? "••••" : formatBRL(selectedAccount.balance)}</span> : null}
            </span>
          </button>
          {kind === "Transferência" ? (
            <button type="button" onClick={() => { setDestinationPicker(true); setInstitutionId(null); go("accounts"); }} className="flex min-w-0 items-center gap-1.5 rounded-full bg-muted px-4 py-3 text-sm font-semibold">
              <ArrowLeftRight size={16} className="shrink-0 text-primary" /><span className="truncate">{accounts.find((a) => a.id === destination)?.name ?? "Para qual conta?"}</span>
            </button>
          ) : null}
          <button type="button" onClick={() => { const el = dateInput.current; if (!el) return; try { el.showPicker(); } catch { el.focus(); } }} className="ml-auto shrink-0 rounded-full bg-muted px-4 py-3 text-sm font-semibold" data-testid="quick-entry-date">{dateLabel}</button>
          <input ref={dateInput} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="sr-only" tabIndex={-1} aria-label="Data" />
        </div>

        {selectedCard && kind === "Despesa" ? (
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]" role="radiogroup" aria-label="Parcelas" data-testid="quick-entry-installments">
            {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={installments === n} onClick={() => setInstallments(n)} className={cn("h-9 shrink-0 rounded-full px-3 text-sm font-semibold tabular-nums transition-colors", installments === n ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {n === 1 ? "À vista" : `${n}x`}
              </button>
            ))}
            {installments > 1 && amountValue > 0 ? <span className="shrink-0 pl-1 text-xs tabular-nums text-muted-foreground">{installments}x de {hidden ? "••••" : formatBRL(Math.round((amountValue / installments) * 100) / 100)}</span> : null}
          </div>
        ) : null}

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nota (opcional)" aria-label="Nota" className="h-12 w-full rounded-2xl bg-muted px-4 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40" />

        {kind !== "Transferência" ? (
          <div className="rounded-2xl bg-muted/60 py-2">
            <div className="flex items-center gap-2 overflow-x-auto px-3 py-1 [scrollbar-width:none]" role="radiogroup" aria-label="Categoria">
              <button type="button" onClick={() => go("categories")} aria-label="Buscar categoria" className="grid size-12 shrink-0 place-items-center rounded-2xl border border-dashed border-border text-muted-foreground"><Search size={18} /></button>
              <button type="button" role="radio" aria-checked={!category} aria-label="Sem categoria" onClick={() => setCategory("")} className={cn("grid shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground transition-all", !category ? "size-14" : "size-12")}><Ban size={20} /></button>
              {kindCategories.map((c) => {
                const active = category === c.id;
                return (
                  <button key={c.id} type="button" role="radio" aria-checked={active} aria-label={c.name} onClick={() => setCategory(c.id)} className={cn("grid shrink-0 place-items-center rounded-2xl transition-all", active ? "size-14 ring-2 ring-current" : "size-12")} style={{ backgroundColor: `${c.color}26`, color: c.color }}>
                    <CategoryIcon name={c.icon} className="size-6" />
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-center text-sm font-medium" style={{ color: selectedCategory?.color }}>{selectedCategory?.name ?? <span className="text-muted-foreground">Sem categoria</span>}</p>
          </div>
        ) : null}

        <div className="grid grid-cols-4 gap-2" data-testid="quick-entry-keypad">
          {KEYS.map((key) => (
            <button key={key} type="button" onClick={() => press(key)} aria-label={key === "⌫" ? "Apagar (segure para limpar)" : key}
              onPointerDown={key === "⌫" ? () => { clearTimer.current = window.setTimeout(() => { setExpr(""); clearTimer.current = null; }, 550); } : undefined}
              onPointerUp={key === "⌫" ? () => { if (clearTimer.current) window.clearTimeout(clearTimer.current); } : undefined}
              onPointerLeave={key === "⌫" ? () => { if (clearTimer.current) window.clearTimeout(clearTimer.current); } : undefined} className={cn("h-12 rounded-2xl text-2xl font-medium transition-transform active:scale-95", OPS.includes(key) ? "bg-primary/10 text-primary" : "bg-muted")}>
              {key === "⌫" ? <Delete className="mx-auto" size={24} aria-hidden="true" /> : key}
            </button>
          ))}
        </div>
        <button type="button" onClick={save} disabled={saveMutation.isPending || !canSave} className="h-13 w-full rounded-2xl bg-primary text-lg font-semibold text-primary-foreground transition-opacity disabled:opacity-40" data-testid="quick-entry-save">
          {saveMutation.isPending ? "Salvando…" : hint ?? "Salvar"}
        </button>
      </div>
    </div>;
  }
  const row = (label: string, val: string, action: () => void) => <button onClick={action} className="flex w-full items-center justify-between border-b border-border py-4 text-left text-sm"><span>{label}</span><span className="flex items-center gap-2 text-primary">{val}<ChevronRight size={15}/></span></button>;
  return <div className={embedded ? "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground" : "mx-auto flex min-h-[min(790px,90dvh)] w-full max-w-md flex-col overflow-hidden rounded-[30px] border border-border bg-background text-foreground shadow-2xl"}>
    <header className="flex items-center gap-3 px-6 pt-7 pb-4"><div className="grid size-11 place-items-center rounded-2xl bg-primary/12 text-primary"><WandSparkles size={20}/></div><div className="flex-1"><div className="font-semibold">Registro inteligente</div><div className="text-xs text-muted-foreground">Escreva, fale ou fotografe</div></div><button aria-label="Voltar" onClick={back} className="grid size-10 place-items-center rounded-full hover:bg-muted"><ArrowLeft size={20}/></button></header>
    <main key={page} className="min-h-0 flex-1 animate-in fade-in slide-in-from-bottom-3 overflow-y-auto overscroll-contain px-6 py-5 duration-300">
      {page === "start" && <><h1 className="mt-2 text-2xl font-semibold leading-tight">Como foi?</h1><div className="mt-5 flex flex-wrap gap-2">{["Café 9 reais no Pix", "Recebi 3100 de salário", "Uber 23 ontem"].map(t => <button key={t} onClick={() => interpret(t)} className="rounded-full border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted">{t}</button>)}</div></>}
      {page === "manual" && <><div className="text-center text-xs text-muted-foreground">REGISTRO MANUAL</div><div className="my-9 text-center text-5xl font-semibold">{format(value)}</div><input aria-label="Nome da movimentação" value={name} onChange={e => setName(e.target.value)} placeholder="Nome da movimentação" className="mb-8 w-full rounded-xl bg-muted p-4 text-center outline-none"/><div className="grid grid-cols-3 gap-2">{["1","2","3","4","5","6","7","8","9","C","0","⌫"].map(k => <button key={k} type="button" className="rounded-full bg-muted py-2.5 text-xl" onClick={() => setValue(v => { const cents = String(Math.round((Number(v) || 0) * 100)); const next = k === "C" ? "" : k === "⌫" ? cents.slice(0, -1) : cents.replace(/^0+/, "") + k; return (Number(next || "0") / 100).toFixed(2); })}>{k}</button>)}</div><button disabled={Number(value) <= 0} onClick={() => go("details")} className={button + " mt-4 w-full bg-primary text-primary-foreground disabled:opacity-40"}>Continuar</button></>}
      {(page === "details" || page === "review") && <><h2 className="mb-4 text-2xl font-semibold">{"Revisar lançamento"}</h2><div className="mb-6 text-center text-4xl font-semibold">{format(value)}</div><input aria-label="Nome" value={name} onChange={e => setName(e.target.value)} placeholder="Descrição (opcional)" className="mb-4 w-full rounded-xl bg-muted p-3 outline-none"/><div className="mb-3 flex gap-1">{(["Despesa","Receita","Transferência"] as Kind[]).map(k => <button key={k} onClick={() => setKind(k)} className={"flex-1 rounded-xl px-1 py-3 text-xs " + (kind === k ? "bg-primary text-primary-foreground" : "bg-muted")}>{k}</button>)}</div>{kind !== "Transferência" && <section className="mb-4"><div className="mb-3 text-sm font-semibold">Categoria</div>{categoriesQuery.isPending ? <p className="text-sm text-muted-foreground">Carregando categorias...</p> : categoriesQuery.isError ? <p role="alert" className="text-sm text-expense">Não foi possível carregar categorias. <button onClick={() => categoriesQuery.refetch()} className="underline">Tentar novamente</button></p> : <div className="grid grid-cols-5 gap-2">{visibleCategories.map(c => <button key={c.id} onClick={() => setCategory(c.id)} className="flex min-w-0 flex-col items-center gap-1"><span className={"grid size-12 place-items-center rounded-full " + (category === c.id ? "ring-2 ring-primary" : "")} style={{backgroundColor: c.color + "33",color:c.color}}><CategoryIcon name={c.icon} className="size-6"/></span><span className="w-full truncate text-center text-xs">{c.name}</span></button>)}<button onClick={() => go("categories")} className="flex flex-col items-center gap-1"><span className="grid size-12 place-items-center rounded-full bg-muted"><Plus size={22}/></span><span className="text-xs">Mais</span></button></div>}</section>}{row(kind === "Transferência" ? "Carteira de origem" : "Carteira", accountLabel, () => {setDestinationPicker(false);setInstitutionId(null);go("accounts")})}{kind === "Transferência" && row("Conta de destino", accounts.find(a => a.id === destination)?.name || "Selecionar", () => {setDestinationPicker(true);setInstitutionId(null);go("accounts")})}{kind === "Despesa" && selectedCard && row("Parcelamento", installments+"x", () => go("installments"))}{row("Mais opções", "Data, nota e anexos", () => go("more"))}{!canSave && <p role="status" className="mt-4 text-sm text-amber-600 dark:text-amber-300">{Number(value) <= 0 ? "Informe um valor maior que zero." : !account ? "Selecione uma conta ou cartão na Carteira." : kind === "Transferência" && (!destination || destination === account) ? "Selecione uma carteira de destino diferente da origem." : !category ? "Escolha uma categoria." : "Escolha uma categoria de despesa ou altere o tipo para Receita."}</p>}<button onClick={save} disabled={saveMutation.isPending || !canSave} className={button + " mt-7 w-full bg-primary text-primary-foreground disabled:opacity-40"}>{saveMutation.isPending ? "Salvando..." : "Salvar movimentação"}</button></>}
      {page === "categories" && <><h2 className="mb-4 text-xl font-semibold">Categoria</h2><input value={categorySearch} onChange={e => setCategorySearch(e.target.value)} placeholder="Buscar categoria" className="mb-3 w-full rounded-xl bg-muted p-3 outline-none"/>{categoriesQuery.isError ? <p role="alert">Erro ao carregar categorias. <button onClick={() => categoriesQuery.refetch()}>Tentar novamente</button></p> : categories.filter(c => c.name.toLowerCase().includes(categorySearch.toLowerCase())).map(c => <button key={c.id} onClick={() => {setCategory(c.id);back()}} className={"mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left " + (category === c.id ? "bg-primary/15" : "bg-muted/60")}><span className="grid size-9 place-items-center rounded-full" style={{backgroundColor:c.color+"33",color:c.color}}><CategoryIcon name={c.icon} className="size-5"/></span><span className="flex-1">{c.name}</span>{category === c.id && <Check size={18} className="text-primary"/>}</button>)}{!categoriesQuery.isPending && !categoriesQuery.isError && categories.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>}</>}
      {page === "pay" && <><h2 className="mb-4 text-xl font-semibold">Pagar com</h2>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contas</p>
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">{accounts.map(a => <button key={a.id} type="button" onClick={() => { setAccount(a.id); setSelectedCardId(null); setInstallments(1); setPayment(""); back(); }} className={"flex w-full items-center gap-3 px-4 py-3.5 text-left " + (account === a.id && !selectedCardId ? "bg-primary/10" : "")}><span className="grid size-9 place-items-center rounded-full bg-income/15 text-income"><Wallet size={18}/></span><span className="flex-1 font-medium">{a.name}</span><span className="text-sm tabular-nums text-muted-foreground">{hidden ? "••••" : formatBRL(a.balance)}</span>{account === a.id && !selectedCardId ? <Check size={18} className="text-primary"/> : null}</button>)}</div>
        {kind === "Despesa" ? <><p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cartões de crédito</p>
        {cards.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nenhum cartão cadastrado. Adicione em Carteira → Novo cartão.</p> : <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">{cards.map(c => <button key={c.id} type="button" onClick={() => { setSelectedCardId(c.id); setAccount(c.payment_account_id ?? accounts[0]?.id ?? ""); setPayment("Crédito"); back(); }} className={"flex w-full items-center gap-3 px-4 py-3.5 text-left " + (selectedCardId === c.id ? "bg-primary/10" : "")} data-testid={"pay-card-" + c.id}><span className="grid size-9 place-items-center rounded-full bg-primary/15 text-primary"><CreditCard size={18}/></span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="block text-xs text-muted-foreground">Fecha dia {c.closing_day} · vence dia {c.due_day}</span></span><span className="text-sm tabular-nums text-muted-foreground">{hidden ? "••••" : `disp. ${formatBRL(c.available)}`}</span>{selectedCardId === c.id ? <Check size={18} className="text-primary"/> : null}</button>)}</div>}</> : null}
      </>}
      {page === "accounts" && <><h2 className="mb-5 text-xl font-semibold">{destinationPicker ? "Carteira de destino" : "Carteira"}</h2>{accountsQuery.isPending || cardsQuery.isPending ? <p className="text-sm text-muted-foreground">Carregando sua carteira...</p> : accountsQuery.isError || cardsQuery.isError ? <p role="alert" className="text-expense">Não foi possível carregar sua carteira. <button onClick={() => {accountsQuery.refetch();cardsQuery.refetch()}} className="underline">Tentar novamente</button></p> : <>{!institutionId || destinationPicker ? <><p className="mb-4 text-sm text-muted-foreground">Selecione a instituição ou conta cadastrada.</p><div className="grid grid-cols-2 gap-3">{accounts.map(a => <button key={a.id} onClick={() => {if(destinationPicker){setDestination(a.id);back()}else setInstitutionId(a.id)}} className={"flex min-h-28 flex-col items-start justify-center gap-2 rounded-2xl border p-4 text-left " + ((destinationPicker ? destination === a.id : institutionId === a.id) ? "border-primary bg-primary/10" : "border-border bg-muted")}><Landmark size={24} className="text-primary"/><span className="text-sm font-medium">{a.name}</span></button>)}</div>{accounts.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Nenhuma instituição ou conta cadastrada.</p>}</> : <><button onClick={() => setInstitutionId(null)} className="mb-5 flex items-center gap-2 text-sm text-primary"><ArrowLeft size={16}/>Trocar instituição</button><h3 className="mb-2 font-semibold">{accounts.find(a => a.id === institutionId)?.name}</h3><p className="mb-4 text-sm text-muted-foreground">Escolha como esta movimentação foi realizada.</p>{paymentsLoading && <p className="mb-3 text-sm text-muted-foreground">Carregando formas de pagamento...</p>}{paymentsError && <p role="alert" className="mb-3 text-sm text-expense">Não foi possível consultar as formas de pagamento desta conta.</p>}<div className="grid grid-cols-2 gap-3">{availablePayments.filter(p => kind !== "Receita" || p !== "Débito").map(p => <button key={p} onClick={() => {setAccount(institutionId);setSelectedCardId(null);setPayment(p);setInstallments(1);setInstitutionId(null);back()}} className={"flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left text-sm " + (account === institutionId && !selectedCardId && payment === p ? "border-primary bg-primary/10" : "border-border bg-muted")}><Wallet size={21} className="text-primary"/>{p}</button>)}{kind === "Despesa" && cardsForAccount(institutionId).map(c => <button key={c.id} onClick={() => {setAccount(institutionId);setSelectedCardId(c.id);setPayment("Crédito");setInstallments(1);setInstitutionId(null);back()}} className={"flex min-h-24 flex-col items-start justify-center gap-2 rounded-2xl border p-4 text-left text-sm " + (selectedCardId === c.id ? "border-primary bg-primary/10" : "border-border bg-muted")}><CreditCard size={22} className="text-primary"/><span>{c.name}</span><span className="text-xs text-muted-foreground">Crédito</span></button>)}</div>{kind === "Despesa" && cardsForAccount(institutionId).length === 0 && <p className="mt-4 text-xs text-muted-foreground">Nenhum cartão de crédito vinculado a esta conta.</p>}</>}</>}</>}
      {page === "installments" && <><h2 className="mb-6 text-xl font-semibold">Parcelamento</h2><div className="grid grid-cols-4 gap-2">{[1,2,3,4,5,6,10,12].map(n => <button key={n} onClick={() => setInstallments(n)} className={"rounded-xl p-3 " + (installments === n ? "bg-primary text-primary-foreground" : "bg-muted")}>{n}x</button>)}</div><p className="my-8 text-muted-foreground">Valor por parcela: {format(String(Number(value || 0) / installments))}</p><button onClick={back} className={button + " w-full bg-primary text-primary-foreground"}>Concluir</button></>}
      {page === "more" && <><h2 className="mb-5 text-xl font-semibold">Mais opções</h2><div className="space-y-1">{row("Data", date, () => document.getElementById("finnos-register-date")?.focus())}<input id="finnos-register-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="mb-3 w-full rounded-xl bg-muted p-3"/>{row("Forma de pagamento", selectedCard ? "Crédito" : payment, () => {setDestinationPicker(false);go("accounts")})}<div className="flex items-center justify-between border-b border-border py-4"><span className="flex items-center gap-3"><Repeat2 size={18}/>Recorrência</span><button onClick={() => setRecurring(!recurring)} className="text-primary">{recurring ? "Sim" : "Não"}</button></div><label className="flex items-center gap-3 pt-4"><StickyNote size={18}/>Nota / Observação</label><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Opcional" className="w-full rounded-xl bg-muted p-3"/><label className="flex items-center gap-3 pt-4"><Paperclip size={18}/>Anexos {attachment && "· " + attachment}</label><input type="file" accept="image/*,.pdf" onChange={e => setAttachment(e.target.files?.[0]?.name || "")} className="w-full py-3 text-sm"/><div className="flex items-center justify-between border-b border-border py-4"><span className="flex items-center gap-3"><Bell size={18}/>Lembrete</span><button onClick={() => setReminder(!reminder)} className="text-primary">{reminder ? "Sim" : "Não"}</button></div><label className="flex items-center gap-3 pt-4"><FolderOpen size={18}/>Projeto</label><input value={project} onChange={e => setProject(e.target.value)} placeholder="Opcional" className="w-full rounded-xl bg-muted p-3"/><label className="flex items-center gap-3 pt-4"><Tag size={18}/>Tags</label><input value={tags} onChange={e => setTags(e.target.value)} placeholder="Adicionar tags" className="w-full rounded-xl bg-muted p-3"/></div><button onClick={back} className={button + " mt-7 w-full bg-primary text-primary-foreground"}>Concluir</button></>}
      {page === "voice" && <div className="flex h-full flex-col items-center justify-center pb-10 text-center"><button type="button" onClick={listening ? stopVoice : startVoice} aria-label={listening ? "Parar" : "Falar"} className={"grid size-24 place-items-center rounded-full transition-colors " + (listening ? "bg-primary text-primary-foreground" : "bg-muted text-primary")}>{listening ? <Square size={30}/> : <Mic size={40}/>}</button>{listening ? <span className="mt-3 h-1 w-16 animate-pulse rounded-full bg-primary/60" aria-hidden="true"/> : null}<p className="mt-6 min-h-12 max-w-xs text-lg">{text || <span className="text-muted-foreground">{listening ? "Pode falar…" : "Toque e diga, por exemplo, “Paguei 45 no Uber”"}</span>}</p></div>}
      {page === "receipt" && <div className="flex h-full flex-col items-center justify-center pb-10 text-center"><ReceiptText size={44} className="text-primary motion-safe:animate-pulse"/><p className="mt-5 font-medium">Lendo o recibo…</p><div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${ocrProgress ?? 5}%` }}/></div>{attachment ? <p className="mt-3 max-w-xs truncate text-xs text-muted-foreground">{attachment}</p> : null}</div>}
      {page === "done" && <div className="py-10 text-center"><div className="mx-auto grid size-28 place-items-center rounded-full border-2 border-primary text-primary"><Check size={60}/></div><h2 className="mt-8 text-2xl">{saveStatus === "pending" ? "Salvo neste dispositivo" : "Registro realizado!"}</h2><p className="mt-5 text-3xl">{format(value)}</p><p className="mt-2 text-muted-foreground">{displayName}</p><p className="mt-8 text-sm text-muted-foreground">{saveStatus === "pending" ? "Aguardando conexão para sincronizar. Não apague os dados do aplicativo enquanto houver registros pendentes." : "Movimentação sincronizada com o FINNOS."}</p><button onClick={() => {setText("");setName("");setValue("");setSaveStatus(null);setExpr("");setPage("entry")}} className={button + " mt-8 w-full bg-primary text-primary-foreground"}>Novo registro</button></div>}
    </main>
    {page === "start" && <div className="mx-4 mb-3 shrink-0 rounded-3xl bg-muted p-3"><textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); interpret(); } }} placeholder="Ex.: Paguei R$ 45 no Uber com o Nubank ontem" className="h-16 w-full resize-none bg-transparent p-2 text-base outline-none"/><div className="flex items-center gap-1"><button type="button" aria-label="Fotografar recibo" onClick={() => cameraInput.current?.click()} className="grid size-11 place-items-center rounded-full hover:bg-background/60"><Camera size={21}/></button><button type="button" aria-label="Falar" onClick={() => { go("voice"); startVoice(); }} className="grid size-11 place-items-center rounded-full hover:bg-background/60"><Mic size={21}/></button><button type="button" aria-label="Anexar arquivo" onClick={() => fileInput.current?.click()} className="grid size-11 place-items-center rounded-full hover:bg-background/60"><Paperclip size={21}/></button><button type="button" aria-label="Interpretar" disabled={!text.trim()} onClick={() => interpret()} className="ml-auto grid size-11 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"><ArrowUp size={21}/></button></div></div>}
    <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { go("receipt"); void readFile(f); } }}/>
    <input ref={fileInput} type="file" accept="image/*,.txt,.csv,text/plain,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { go("receipt"); void readFile(f); } }}/>
    {!embedded && <footer className="pb-3 text-center text-xs text-muted-foreground">FINNOS · Registro de movimentações</footer>}
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
