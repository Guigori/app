import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, FileText, History, RotateCcw, Upload, Camera } from "lucide-react";
import { toast } from "sonner";
import { useOwnHeader } from "@/components/layout/BackButton";
import { useBalanceHidden } from "@/lib/balance";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { AdjustBalanceDialog } from "@/components/accounts/AdjustBalanceDialog";
import { TransactionDialog } from "@/components/transactions/TransactionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  completeReconciliation, createCardReconciliation, createReconciliation, fetchAccountReconciliations, fetchAccounts,
  fetchCardReconciliations, fetchCards, fetchInvoice, fetchReconciliation, fetchTransactions, resolveReconciliation,
  undoReconciliationEvent,
} from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, formatDate, parseAmount, todayISO } from "@/lib/format";
import { ofxClosingBalance, parseFinancialFile } from "@/lib/importFinancial";
import { pdfTextPages, pdfToStatementCsv } from "@/lib/pdfStatement";
import { daysAgoISO, fingerprint } from "@/lib/statementImport";
import { cn } from "@/lib/utils";
import type { Account, CreditCard, ReconLine, Reconciliation as Recon, ReconResolveInput, TransactionInput } from "@/types/finnos";

type Filter = "tudo" | "bateu" | "nao";
type Tag = "ok" | "missing" | "diff" | "probable" | "ignored";
const tagOf = (l: ReconLine): Tag => l.state === "matched" ? "ok" : l.state === "ignored" ? "ignored" : l.level === "value_diff" ? "diff" : l.level === "probable" ? "probable" : "missing";
const TAG_STYLE: Record<Tag, string> = {
  ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", missing: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  diff: "bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300", probable: "bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  ignored: "bg-muted text-muted-foreground",
};
const TAG_MARK: Record<Tag, string> = { ok: "✓", missing: "!", diff: "≠", probable: "?", ignored: "–" };
let hideValues = false;
const money = (cents: number) => (hideValues ? "R$ ••••" : formatBRL(cents / 100));
/** Where each of the first banks keeps the statement export (prototype tip). */
const HOW_TO: Record<string, string> = {
  nubank: "No app: Conta → Extrato → ícone de exportar. Escolha até 90 dias.",
  "itaú": "No app: Extrato → Exportar → OFX ou PDF. Escolha até 90 dias.",
  bradesco: "No app: Saldos e extratos → Extrato → Exportar (OFX ou PDF).",
  inter: "No app: Extrato → Exportar → escolha o período e o formato OFX.",
  "banco do brasil": "No app: Extrato → Compartilhar → OFX ou PDF, até 90 dias.",
};
const LEVEL_LABEL: Record<ReconLine["level"], string> = {
  strong: "Bateu", already: "Já conferida", linked: "Bateu", probable: "Provável", value_diff: "Valor diferente", only_statement: "Só no extrato",
};
const ACTION_LABEL: Record<string, string> = {
  confirm: "confirmou", separate: "separou", use_bank_value: "usou o valor do banco", keep_value: "manteve o valor do FINNOS",
  link: "registrou e ligou", ignore: "ignorou", keep: "manteve", keep_pending: "marcou como ainda vai cair", delete: "excluiu", undo: "desfez",
};

export default function Reconciliation() {
  const { accountId = "", cardId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const isCard = Boolean(cardId);
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards, enabled: isCard });
  const invoiceQuery = useQuery({ queryKey: ["invoice", cardId, searchParams.get("cycle")], queryFn: () => fetchInvoice(cardId, searchParams.get("cycle") ?? undefined), enabled: isCard });
  const account = accountsQuery.data?.find((a) => a.id === accountId);
  const card = cardsQuery.data?.find((c) => c.id === cardId);
  const cycle = isCard ? (invoiceQuery.data?.cycle_end ?? null) : null;
  const scopeKey = isCard ? `card:${cardId}` : accountId;
  const listQuery = useQuery({
    queryKey: ["reconciliations", scopeKey],
    queryFn: () => (isCard ? fetchCardReconciliations(cardId) : fetchAccountReconciliations(accountId)),
    enabled: Boolean(accountId || cardId),
  });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const navigate = useNavigate();
  useOwnHeader();
  const { hidden, toggle } = useBalanceHidden();
  const [startNew, setStartNew] = useState(false);
  const activeId = currentId ?? (startNew ? null : listQuery.data?.find((r) => r.status === "pronta" && (!isCard || r.cycle === cycle))?.id ?? null);
  const recQuery = useQuery({ queryKey: ["reconciliation", activeId], queryFn: () => fetchReconciliation(activeId!), enabled: Boolean(activeId) });
  const rec = recQuery.data;

  const refresh = async (next?: Recon) => {
    if (next) queryClient.setQueryData(["reconciliation", next.id], (old: Recon | undefined) => ({ ...old, ...next }));
    await Promise.all(["reconciliation", "reconciliations", "accounts", "transactions", "dashboard", "invoice", "cards"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] })));
  };

  if (accountsQuery.isPending || listQuery.isPending || (isCard && (cardsQuery.isPending || invoiceQuery.isPending))) return <FinnosPageLoading />;
  if (isCard ? !card || !cycle : !account) return <p className="p-6 text-sm text-muted-foreground">{isCard ? "Cartão não encontrado." : "Conta não encontrada."}</p>;

  const subtitle = isCard
    ? `${[card!.name, card!.institution].filter(Boolean).join(" · ")} · fecha em ${formatDate(cycle!)}${invoiceQuery.data?.reconciled ? " · conferida" : ""}`
    : `${[account!.name, account!.institution].filter(Boolean).join(" · ")}${account!.reconciled_until ? ` · conferida até ${formatDate(account!.reconciled_until)}` : ""}`;
  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 pb-24">
      <header className="flex items-center gap-2.5">
        <button type="button" onClick={() => navigate(-1)} aria-label="Voltar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-lg font-bold leading-tight sm:text-xl">{isCard ? "Conferir fatura" : "Conferir com extrato"}</h1>
          <p className="truncate text-xs text-muted-foreground" data-keep="" data-testid="recon-account">{subtitle}</p>
        </div>
        <button type="button" onClick={() => setHistoryOpen(true)} disabled={!rec?.history?.length} aria-label="Histórico de conferências" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card disabled:opacity-40" data-testid="recon-history-open"><History className="size-5" /></button>
        <button type="button" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card">{hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
      </header>
      {rec && !startNew ? (
        <ReconView rec={rec} account={account ?? null} card={card ?? null} onChanged={refresh} hidden={hidden}
          historyOpen={historyOpen} onHistoryOpen={setHistoryOpen}
          onNew={() => { setStartNew(true); setCurrentId(null); }} />
      ) : (
        <UploadCard accountId={accountId} account={account ?? null} card={isCard ? card! : null} cycle={cycle}
          onCreated={(created) => { setStartNew(false); setCurrentId(created.id); void refresh(created); }} />
      )}
    </div>
  );
}

function UploadCard({ accountId, account, card, cycle, onCreated }: { accountId: string; account: Account | null; card: CreditCard | null; cycle: string | null; onCreated: (rec: Recon) => void }) {
  const [adjusting, setAdjusting] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  const [days, setDays] = useState<30 | 60 | 90>(30);
  const [closingRaw, setClosingRaw] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [operationId] = useState(() => crypto.randomUUID());

  const read = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      if (/\.(png|jpe?g|heic|webp)$/i.test(file.name)) {
        setStatus("Foto e PDF escaneado precisam do leitor de documentos do servidor, que ainda não está ligado. Use OFX, CSV ou o PDF do internet banking.");
        return;
      }
      const isPdf = /\.pdf$/i.test(file.name);
      if (card && cycle) {
        // Invoice: the PDF's text lines are read by the FDI (fees, installments, total check).
        const pages = isPdf ? await pdfTextPages(file).catch(() => []) : [];
        const text = isPdf ? pages.map((p) => p.text).join("\n") : await file.text();
        if (isPdf && text.replace(/\s/g, "").length < 40) {
          setStatus("Este PDF parece escaneado. Ainda não dá para ler aqui; use o PDF do app do banco ou o CSV.");
          return;
        }
        const rows = isPdf ? [] : parseFinancialFile(text, "invoice");
        if (!isPdf && !rows.length) { setStatus("Não encontrei lançamentos neste arquivo."); return; }
        const created = await createCardReconciliation(card.id, {
          cycle, file_name: file.name, file_hash: await fingerprint(text), source: isPdf ? "pdf" : /<OFX|<STMTTRN/i.test(text) ? "ofx" : "csv",
          pages: isPdf ? pages : undefined,
          lines: isPdf ? undefined : rows.map((r) => ({ date: r.date, description: r.description.slice(0, 200), value: Math.abs(r.value), direction: r.type === "receita" ? "in" : "out", fitid: r.fitid ?? null })),
        }, operationId);
        onCreated(created);
        return;
      }
      const text = isPdf ? await pdfToStatementCsv(file).catch(() => "") : await file.text();
      const rows = parseFinancialFile(text, "statement");
      if (!rows.length) {
        setStatus(isPdf ? "Não encontrei movimentações no PDF. Se ele for escaneado, ainda não dá para ler aqui; tente o OFX ou o CSV do banco." : "Não encontrei movimentações neste arquivo.");
        return;
      }
      const end = todayISO();
      const start = daysAgoISO(days);
      const inPeriod = rows.filter((r) => r.date >= start && r.date <= end);
      const outside = rows.length - inPeriod.length;
      const fromFile = /<OFX|<STMTTRN/i.test(text) ? ofxClosingBalance(text) : null;
      const typed = closingRaw.trim() ? parseAmount(closingRaw) : null;
      const created = await createReconciliation(accountId, {
        period_start: start, period_end: end, file_name: file.name, file_hash: await fingerprint(text),
        source: /<OFX|<STMTTRN/i.test(text) ? "ofx" : isPdf ? "pdf" : "csv",
        bank_closing_balance: typed ?? fromFile,
        lines: inPeriod.map((r) => ({ date: r.date, description: r.description.slice(0, 200), value: Math.abs(r.value), direction: r.type === "receita" ? "in" : "out", fitid: r.fitid ?? null })),
      }, operationId);
      if (outside) toast.info(`${outside} linha(s) fora dos últimos ${days} dias ficaram de fora.`);
      onCreated(created);
    } catch (error) {
      setStatus(getApiErrorMessage(error, "Não foi possível ler o extrato."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const bankName = (card?.institution || account?.institution || "").trim();
  const tip = HOW_TO[bankName.toLocaleLowerCase("pt-BR").replace(/^banco /, "")] ?? HOW_TO[bankName.toLocaleLowerCase("pt-BR")];
  return (
    <section data-testid="recon-upload">
      <h2 className="mt-2 font-heading text-2xl font-bold tracking-[-0.02em]">{card ? "Chegou a fatura? Anexe aqui" : "Anexe o extrato do banco"}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {card ? "O FINNOS lê cada compra da fatura e mostra tudo: o que bateu com o registrado e o que não bateu (valores, parcelas, tarifas e repetidos)." : "O FINNOS compara cada linha do extrato com os seus lançamentos e mostra tudo: o que bateu e o que não bateu."} Nada muda sem você decidir.
      </p>
      {card ? null : (<>
        <p className="mb-2 mt-5 text-[13px] font-semibold">Período do extrato <span className="font-normal text-muted-foreground">(até 90 dias)</span></p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Período">
          {([30, 60, 90] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} data-testid={`recon-days-${d}`}
              className={cn("h-[42px] rounded-full text-[13px] font-semibold", days === d ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card")}>{d} dias</button>
          ))}
        </div>
      </>)}
      <input ref={input} type="file" accept=".ofx,.qfx,.csv,.txt,.pdf,image/*" className="hidden" onChange={(e) => void read(e.target.files?.[0])} data-testid="recon-file-input" />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} data-testid="recon-attach"
        className="mt-4 flex w-full flex-col items-center gap-2.5 rounded-3xl border-2 border-dashed border-primary/40 bg-card px-5 py-7">
        <span className="grid size-14 place-items-center rounded-[18px] bg-primary/[0.07] text-primary"><Upload className="size-[26px]" aria-hidden="true" /></span>
        <strong className="text-base">{busy ? "Lendo…" : card ? "Anexar fatura em PDF" : "Escolher arquivo do extrato"}</strong>
        <span className="text-[13px] text-muted-foreground">{card ? "Ou CSV/OFX, se o banco oferecer" : "OFX, CSV ou PDF · até 90 dias"}</span>
      </button>
      {card ? (<>
        <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void read(e.target.files?.[0])} data-testid="recon-photo-input" />
        <button type="button" onClick={() => photo.current?.click()} disabled={busy} data-testid="recon-photo"
          className="mt-2.5 flex w-full items-center gap-3 rounded-[20px] border border-border bg-card px-4 py-3.5 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-primary/[0.07] text-primary"><Camera className="size-5" aria-hidden="true" /></span>
          <span className="flex-1"><strong className="block text-sm">Tirar foto da fatura</strong><span className="block text-xs text-muted-foreground">Funciona com fatura impressa ou print</span></span>
        </button>
      </>) : null}
      {status ? <p role="alert" className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" data-testid="recon-upload-status">{status}</p> : null}
      {card ? null : (
        <label className="mt-3.5 flex items-center justify-between gap-3 rounded-[20px] border border-border bg-card px-4 py-3">
          <span className="text-[13px]"><span className="block font-semibold">Saldo no banco hoje</span><span className="text-muted-foreground">Opcional; o OFX já traz</span></span>
          <input id="recon-closing" inputMode="decimal" placeholder="R$ 0,00" value={closingRaw} onChange={(e) => setClosingRaw(e.target.value)} data-testid="recon-closing-input"
            className="h-10 w-[130px] rounded-xl border border-border bg-background px-2.5 text-right font-heading text-[15px] font-bold outline-none" />
        </label>
      )}
      {bankName ? (
        <div className="mt-3.5 rounded-[20px] border border-border bg-card px-4 py-3.5">
          <p className="text-[13px] font-bold">Como baixar no {bankName}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{tip ?? (card ? "No app do banco, abra a fatura e procure “Baixar PDF” ou “Exportar”." : "No app do banco: Extrato → Exportar. Escolha até 90 dias e envie o arquivo aqui.")}</p>
        </div>
      ) : null}
      {!card && account ? (
        <div className="mt-3.5 rounded-[20px] border border-border bg-card px-4 py-3.5">
          <p className="text-sm font-bold">Sem extrato? Só corrigir o saldo</p>
          <p className="mb-3 mt-1 text-[13px] text-muted-foreground">Informe o saldo do banco e o FINNOS cria um ajuste com a diferença, que também vai para o histórico.</p>
          <button type="button" onClick={() => setAdjusting(true)} className="h-11 w-full rounded-full bg-primary/10 text-sm font-bold text-primary" data-testid="recon-upload-adjust">Ajustar saldo</button>
          <AdjustBalanceDialog open={adjusting} onOpenChange={setAdjusting} account={account} date={todayISO()} />
        </div>
      ) : null}
    </section>
  );
}

function ReconView({ rec, account, card, onChanged, onNew, hidden, historyOpen, onHistoryOpen }: {
  rec: Recon; account: Account | null; card: CreditCard | null; onChanged: (next?: Recon) => Promise<void>; onNew: () => void;
  hidden: boolean; historyOpen: boolean; onHistoryOpen: (open: boolean) => void;
}) {
  hideValues = hidden;
  const isCard = rec.scope === "card";
  const accountId = account?.id ?? "";
  const accountName = isCard ? `Fatura ${card?.name ?? ""}` : account?.name ?? "";
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<Filter>("tudo");
  const [adjusting, setAdjusting] = useState(false);
  const [registerLine, setRegisterLine] = useState<ReconLine | null>(null);
  const txQuery = useQuery({
    queryKey: ["transactions", "recon", rec.id, rec.period_start],
    queryFn: () => fetchTransactions({ start_date: rec.period_start, end_date: rec.period_end }),
  });
  const names = useMemo(() => new Map((txQuery.data ?? []).map((t) => [t.id, t])), [txQuery.data]);
  const done = rec.status === "concluida";

  const resolve = useMutation({
    mutationFn: (input: ReconResolveInput) => resolveReconciliation(rec.id, input),
    onSuccess: (next) => onChanged(next),
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const undo = useMutation({
    mutationFn: (eventId: string) => undoReconciliationEvent(rec.id, eventId),
    onSuccess: (next) => { toast.success("Decisão desfeita."); return onChanged(next); },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const complete = useMutation({
    mutationFn: () => completeReconciliation(rec.id, note),
    onSuccess: (next) => { toast.success(isCard ? "Fatura conferida." : `Conta conferida até ${formatDate(rec.period_end)}.`); return onChanged(next); },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  const bank = rec.bank_closing_cents;
  const diff = bank == null ? null : bank - rec.finnos_closing_cents;
  const matched = rec.lines.filter((l) => l.state === "matched").length;
  const visible = rec.lines.filter((l) => filter === "tudo" || (filter === "bateu" && l.state === "matched") || (filter === "nao" && l.state !== "matched"));
  const prefill: Partial<TransactionInput> | undefined = registerLine ? {
    type: registerLine.direction === "in" ? "receita" : "despesa", name: registerLine.description, value: registerLine.cents / 100,
    date: registerLine.date, status: "pago", ...(isCard ? { card_id: card?.id ?? null } : { account_id: accountId }),
    notes: isCard ? "Registrado na conferência da fatura." : "Registrado na conferência com o extrato.",
  } : undefined;

  return (
    <div className="space-y-5" data-testid="recon-view">
      <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3">
        <FileText className="size-[18px] shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[13px]"><strong className="block truncate">{rec.file_name || (isCard ? "fatura" : "extrato")}</strong>
          <span className="text-muted-foreground">{formatDate(rec.period_start).slice(0, 5)} a {formatDate(rec.period_end).slice(0, 5)} · {rec.lines.length} lançamentos
            {isCard && rec.invoice_fields?.minimum_payment_cents != null ? ` · mínimo ${money(rec.invoice_fields.minimum_payment_cents)}` : ""}
            {isCard && rec.invoice_fields?.due_date ? ` · vence ${formatDate(rec.invoice_fields.due_date).slice(0, 5)}` : ""}</span></span>
        {!done ? <button type="button" onClick={onNew} className="text-[13px] font-bold text-primary" data-testid="recon-new">Trocar</button> : null}
      </div>

      <section className={cn("rounded-[22px] border-2 bg-card p-4", diff === 0 && !rec.pending ? "border-emerald-400" : "border-amber-300")} data-testid="recon-balances">
        <div className="grid grid-cols-2 gap-3">
          <span><span className="block text-xs text-muted-foreground">{isCard ? "Total na fatura do banco" : "Saldo no extrato"}</span><strong className="font-heading text-xl tabular-nums" data-testid="recon-bank">{bank == null ? "—" : money(bank)}</strong></span>
          <span><span className="block text-xs text-muted-foreground">No FINNOS</span><strong className="font-heading text-xl tabular-nums" data-testid="recon-finnos">{money(rec.finnos_closing_cents)}</strong></span>
        </div>
        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-primary/10"><span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${rec.lines.length ? Math.round((matched / rec.lines.length) * 100) : 0}%` }} /></span>
        <p className="mt-2 flex justify-between gap-2 text-[13px]">
          <strong className={diff ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>
            {diff == null ? "Sem saldo do banco" : diff === 0 ? (rec.pending ? "Totais batem, falta revisar" : "Tudo bate") : <>Diferença de <span data-testid="recon-diff">{money(Math.abs(diff))}</span></>}
            {diff === 0 ? <span className="sr-only" data-testid="recon-diff">{money(0)}</span> : null}
          </strong>
          <span className="text-muted-foreground">{matched} de {rec.lines.length} bateram</span>
        </p>
        {isCard && rec.invoice_checks?.some((c) => c.name === "invoice_total") ? (
          <p className="mt-1.5 text-xs text-muted-foreground" data-testid="recon-invoice-check">
            {rec.invoice_checks.find((c) => c.name === "invoice_total")?.passed ? "As linhas lidas somam o total impresso na fatura." : "As linhas lidas não somam o total impresso: alguma pode ter ficado de fora."}
          </p>
        ) : null}
      </section>

      <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1" role="tablist" aria-label="Filtrar">
        {([["tudo", "Tudo", rec.lines.length], ["bateu", "Bateu", matched], ["nao", "Não bateu", rec.lines.length - matched]] as const).map(([key, label, count]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} data-testid={`recon-filter-${key}`}
            className={cn("h-10 rounded-full text-xs font-semibold", filter === key ? "bg-card text-primary shadow-[0_1px_4px_rgba(7,15,82,0.14)]" : "text-muted-foreground")}>{label} ({count})</button>
        ))}
      </div>

      <ul className="overflow-hidden rounded-[22px] border border-border bg-card" data-testid="recon-lines">
        {visible.map((line) => {
          const tx = line.tx_id ? names.get(line.tx_id) : undefined;
          return (
            <li key={line.index} className={cn("space-y-2 border-b border-border/60 px-3.5 py-3 last:border-b-0", line.state !== "matched" && line.state !== "ignored" && "bg-amber-50/50 dark:bg-amber-500/5")} data-testid={`recon-line-${line.index}`} data-state={line.state}>
              <div className="flex items-start gap-3">
                <span className={cn("grid size-[30px] shrink-0 place-items-center rounded-[10px] text-xs font-bold", TAG_STYLE[tagOf(line)])} aria-hidden="true">{TAG_MARK[tagOf(line)]}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{line.description}{line.installment ? ` · parcela ${line.installment.current}/${line.installment.total}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(line.date)}{tx ? ` · no FINNOS: ${tx.name} (${formatBRL(tx.value)})` : ""}</p>
                  {line.reasons.length ? <p className="text-xs text-muted-foreground">{line.reasons.join(" · ")}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn("text-sm font-bold tabular-nums", line.direction === "in" && "text-emerald-700 dark:text-emerald-400")}>
                    {line.direction === "in" ? "+ " : "− "}{money(line.cents)}
                  </p>
                  <span className={cn("mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold", TAG_STYLE[tagOf(line)])}>
                    {line.state === "ignored" ? "Ignorada" : line.state === "matched" ? (line.kept_difference ? "Mantido" : LEVEL_LABEL[line.level]) : isCard && line.level === "only_statement" ? "Só na fatura" : LEVEL_LABEL[line.level]}
                  </span>
                </div>
              </div>
              {!done && line.state === "review" && line.level === "probable" ? (
                <div className="flex flex-wrap gap-2 pl-[42px]">
                  <Button size="sm" className="rounded-full" onClick={() => resolve.mutate({ line: line.index, action: "confirm" })} data-testid={`recon-confirm-${line.index}`}>É o mesmo</Button>
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate({ line: line.index, action: "separate" })} data-testid={`recon-separate-${line.index}`}>São diferentes</Button>
                </div>
              ) : null}
              {!done && line.state === "review" && line.level === "value_diff" ? (
                <div className="flex flex-wrap gap-2 pl-[42px]">
                  <Button size="sm" className="rounded-full" onClick={() => resolve.mutate({ line: line.index, action: "use_bank_value" })} data-testid={`recon-bank-value-${line.index}`}>Usar o valor do banco</Button>
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate({ line: line.index, action: "keep_value" })} data-testid={`recon-keep-value-${line.index}`}>Manter o do FINNOS</Button>
                </div>
              ) : null}
              {!done && line.state === "open" ? (
                <div className="flex flex-wrap gap-2 pl-[42px]">
                  <Button size="sm" className="rounded-full" onClick={() => setRegisterLine(line)} data-testid={`recon-register-${line.index}`}>Registrar</Button>
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate({ line: line.index, action: "ignore" })} data-testid={`recon-ignore-${line.index}`}>Ignorar</Button>
                </div>
              ) : null}
            </li>
          );
        })}
        {visible.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">Nada neste filtro.</li> : null}
      </ul>
      <p className="mx-1 text-xs text-muted-foreground">Decida o que não bateu: registrar, corrigir o valor, ignorar. Cada decisão fica no histórico e pode ser desfeita.</p>

      {rec.finnos.length ? (
        <section className="space-y-2" data-testid="recon-finnos-only">
          <h2 className="mx-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Só no FINNOS · {rec.finnos.filter((f) => f.state === "open").length} para decidir</h2>
          <ul className="overflow-hidden rounded-[22px] border border-border bg-card">
            {rec.finnos.map((item) => {
              const tx = names.get(item.tx_id);
              return (
                <li key={item.tx_id} className="space-y-2 border-b border-border/60 px-3.5 py-3 last:border-b-0" data-testid={`recon-finnos-${item.tx_id}`} data-state={item.state}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{tx?.name ?? item.name ?? "Lançamento"}</p>
                      <p className="text-xs text-muted-foreground">{tx ? formatDate(tx.date) : ""}{item.repeated_of ? " · parece repetido" : ""}</p>
                    </div>
                    <p className="shrink-0 text-sm font-bold tabular-nums">{tx ? formatBRL(tx.value) : item.cents != null ? money(item.cents) : ""}</p>
                  </div>
                  {!done && item.state === "open" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => resolve.mutate({ tx_id: item.tx_id, action: "keep_pending" })} data-testid={`recon-pending-${item.tx_id}`}>{isCard ? "Vai na próxima fatura" : "Ainda vai cair"}</Button>
                      <Button size="sm" variant="outline" onClick={() => resolve.mutate({ tx_id: item.tx_id, action: "keep" })} data-testid={`recon-keep-${item.tx_id}`}>Manter</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => resolve.mutate({ tx_id: item.tx_id, action: "delete" })} data-testid={`recon-delete-${item.tx_id}`}>
                        {item.repeated_of ? "Excluir o repetido" : "Excluir"}
                      </Button>
                    </div>
                  ) : <p className="text-xs text-muted-foreground">{item.state === "kept" ? "Mantido" : item.state === "pending" ? "Ainda vai cair" : "Excluído"}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Dialog open={historyOpen} onOpenChange={onHistoryOpen}>
        <DialogContent className="rounded-[30px] sm:max-w-md" data-testid="recon-history">
          <DialogTitle className="font-heading text-xl">Histórico de conferências</DialogTitle>
          <DialogDescription>Cada correção feita a partir do {isCard ? "PDF da fatura" : "extrato"} fica guardada, com quando e o que mudou.</DialogDescription>
          <ul className="max-h-[60dvh] overflow-y-auto">
            {(rec.history ?? []).map((event) => (
              <li key={event.id} className="flex gap-3 border-t border-border/60 py-3">
                <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", event.undone_by ? "bg-primary/30" : "bg-primary")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-semibold", event.undone_by && "line-through text-muted-foreground")}>
                    Você {ACTION_LABEL[event.action] ?? event.action} · {event.target.startsWith("line:") ? (rec.lines[Number(event.target.slice(5))]?.description ?? `linha ${Number(event.target.slice(5)) + 1}`) : "lançamento do FINNOS"}
                  </span>
                  {event.created_at ? <span className="block text-xs text-muted-foreground">{formatDate(String(event.created_at).slice(0, 10))} às {String(event.created_at).slice(11, 16)}</span> : null}
                </span>
                {!done && !event.undone_by && !event.undo_of ? (
                  <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={undo.isPending} onClick={() => undo.mutate(event.id)} data-testid={`recon-undo-${event.seq}`}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Desfazer
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <div className={cn("space-y-2 rounded-[22px] border p-4", done ? "border-emerald-300 bg-emerald-50/95 dark:bg-emerald-500/15" : "border-border bg-card")}>
        {done ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-income" data-testid="recon-done">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{isCard ? `${accountName} conferida.` : `${accountName} conferida até ${formatDate(rec.period_end)}.`}
          </p>
        ) : rec.pending ? (
          <p className="text-sm text-muted-foreground" data-testid="recon-pending-count">Faltam {rec.pending} decisão(ões) para concluir.</p>
        ) : diff ? (
          <p className="text-sm" data-testid="recon-diff-left">Tudo decidido, mas {isCard ? "os totais" : "os saldos"} ainda diferem em {money(diff)}.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Tudo decidido. Os saldos batem.</p>
        )}
        {!done && isCard && diff && !rec.pending ? (
          <Input placeholder="Explique a diferença (ex.: estorno vem na próxima)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="recon-note-input" />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {!done ? (
            <Button disabled={rec.pending > 0 || complete.isPending || (Boolean(diff) && (!isCard || note.trim().length < 3))} onClick={() => complete.mutate()} className="rounded-full" data-testid="recon-complete">
              {isCard && diff ? "Concluir com a diferença" : "Concluir conferência"}
            </Button>
          ) : null}
          {!done && !isCard && account && diff && !rec.pending ? (
            <Button variant="outline" className="rounded-full" onClick={() => setAdjusting(true)} data-testid="recon-adjust">Corrigir o saldo</Button>
          ) : null}
          {done ? <Button variant="ghost" className="rounded-full" onClick={onNew} data-testid="recon-new-after">Nova conferência</Button> : null}
        </div>
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <Link to={isCard && card ? `/cartoes/${card.id}` : account ? `/contas/${account.id}/configurar` : "/contas"} className="grid h-12 place-items-center rounded-full border border-border bg-card text-sm font-bold" data-testid="recon-later">
            {done ? "Voltar" : "Terminar depois"}
          </Link>
          {isCard && card ? (
            <Link to={`/cartoes/${card.id}?pagar=1`} className="grid h-12 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground" data-testid="recon-pay">Pagar fatura</Link>
          ) : (
            <Link to="/contas" className="grid h-12 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">Voltar à Carteira</Link>
          )}
        </div>
      </div>

      {account ? <AdjustBalanceDialog open={adjusting} onOpenChange={setAdjusting} account={account} suggested={bank == null ? null : bank / 100}
        date={rec.period_end} reconciliationId={rec.id} onDone={() => void onChanged()} /> : null}
      <TransactionDialog open={Boolean(registerLine)} onOpenChange={(open) => { if (!open) setRegisterLine(null); }} prefill={prefill}
        onSaved={(tx) => { const line = registerLine; setRegisterLine(null); if (line) resolve.mutate({ line: line.index, action: "link", tx_id: tx.id }); }} />
    </div>
  );
}
