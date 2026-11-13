import { useEffect, useMemo, useRef, useState } from "react";
import { defaultAccount } from "@/lib/walletDefaults";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { apiPost } from "@/lib/api";
import { createTransaction, fetchAccounts, fetchCards, fetchTransactions, updateTransaction } from "@/lib/data";
import { formatBRL, formatDate } from "@/lib/format";
import { parseFinancialFile, type ImportRow } from "@/lib/importFinancial";
import { matchImportRows, type ImportMatch } from "@/lib/importMatching";
import { isLocalMode } from "@/lib/mode";
import { daysAgoISO, fingerprint } from "@/lib/statementImport";
import { pdfToStatementCsv } from "@/lib/pdfStatement";
import type { Transaction, TransactionInput } from "@/types/finnos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Decision = "import" | "skip" | "merge" | null;

interface Row extends ImportRow {
  match: ImportMatch;
  decision: Decision;
}

const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

function inputFrom(tx: Transaction): TransactionInput {
  return {
    name: tx.name, value: tx.value, type: tx.type, status: tx.status, date: tx.date, account_id: tx.account_id,
    card_id: tx.card_id, to_account_id: tx.to_account_id, category_id: tx.category_id, fixed: tx.fixed,
    recurrence: tx.recurrence, installment: tx.installment, total_installments: tx.total_installments,
    current_installment: tx.current_installment, adjusted_value: tx.adjusted_value, attachment: tx.attachment,
    notes: tx.notes, notify_enabled: tx.notify_enabled,
  };
}

/** Bring the last 90 days from bank statements and card invoices (OFX, QFX, CSV, TXT).
 *  Every line is compared with what is already registered (date, value, name, category, time):
 *  likely duplicates start as "É o mesmo", similar ones wait for the user to decide
 *  (same, different or merge), and the same file always maps to the same operation IDs. */
export function StatementImportDialog({ open, onOpenChange, initialTarget }: { open: boolean; onOpenChange: (open: boolean) => void; initialTarget?: string }) {
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled: open });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards, enabled: open });
  const accounts = (accountsQuery.data ?? []).filter((a) => a.active);
  const cards = (cardsQuery.data ?? []).filter((c) => c.active);
  const [target, setTarget] = useState(initialTarget ?? "");
  const [onlyRecent, setOnlyRecent] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open && initialTarget) setTarget(initialTarget); }, [open, initialTarget]);

  const targetCard = cards.find((c) => `card:${c.id}` === target);
  const targetAccount = accounts.find((a) => `account:${a.id}` === target);
  const since = daysAgoISO(90);
  const visible = useMemo(() => rows.filter((r) => !onlyRecent || r.date >= since), [rows, onlyRecent, since]);
  const toImport = visible.filter((r) => r.decision === "import");
  const toMerge = visible.filter((r) => r.decision === "merge");
  const pending = visible.filter((r) => r.decision === null);
  const flagged = visible.filter((r) => r.match.level !== "new");

  const reset = () => { setRows([]); setFileNames([]); setImporting(null); };
  const close = (next: boolean) => { if (importing) return; onOpenChange(next); if (!next) reset(); };
  const decide = (id: string, decision: Decision) => setRows((all) => all.map((r) => (r.id === id ? { ...r, decision } : r)));

  const readFiles = async (files: FileList | null) => {
    if (!files?.length || (!targetCard && !targetAccount)) return;
    const parsed: ImportRow[] = [];
    for (const file of Array.from(files)) {
      if (!/\.(csv|ofx|qfx|txt|pdf)$/i.test(file.name)) { toast.info(`${file.name}: use PDF, OFX, QFX, CSV ou TXT.`); continue; }
      const text = /\.pdf$/i.test(file.name) ? await pdfToStatementCsv(file).catch(() => "") : await file.text();
      const digest = await fingerprint(text);
      const lines = parseFinancialFile(text, targetCard ? "invoice" : "statement");
      if (lines.length === 0) toast.error(`${file.name}: não encontrei movimentações.`);
      parsed.push(...lines.map((row, index) => ({ ...row, id: `${digest.slice(0, 32)}-${index}` })));
    }
    const dates = parsed.map((r) => r.date).sort();
    // What is already registered in this account (or card), a few days around the file.
    const existing = dates.length
      ? (await fetchTransactions({ start_date: shiftDate(dates[0], -3), end_date: shiftDate(dates[dates.length - 1], 3) }).catch(() => [] as Transaction[]))
          .filter((tx) => (targetCard ? tx.card_id === targetCard.id : tx.account_id === targetAccount?.id && !tx.card_id))
      : [];
    const matches = matchImportRows(parsed.filter((r) => !r.blocked).map((r) => ({ id: r.id, date: r.date, value: r.value, type: r.type, description: r.description, category_id: r.category_id, time: r.time })), existing);
    setRows(parsed.map((row) => {
      const match = matches.get(row.id) ?? { level: "new" as const, score: 0, existing: null, reasons: [] };
      const decision: Decision = row.blocked ? "skip" : match.level === "duplicate" ? "skip" : match.level === "similar" ? null : row.selected ? "import" : "skip";
      return { ...row, match, decision };
    }));
    setFileNames(Array.from(files).map((f) => f.name));
  };

  const runImport = async () => {
    const accountId = targetAccount?.id ?? targetCard?.payment_account_id ?? defaultAccount(accounts)?.id ?? accounts[0]?.id;
    if (!accountId) { toast.error("Cadastre uma conta antes de importar."); return; }
    const total = toImport.length + toMerge.length;
    setImporting({ done: 0, total });
    let ok = 0;
    for (const row of toImport) {
      const input: TransactionInput = {
        name: row.description.trim().slice(0, 100) || "Movimentação importada",
        value: row.value, type: row.type, status: "pago", date: row.date, account_id: accountId,
        card_id: targetCard ? targetCard.id : null, to_account_id: null, category_id: row.category_id,
        fixed: false, recurrence: null, installment: false, total_installments: null, current_installment: null,
        adjusted_value: null, attachment: null, notes: "Importado de extrato após revisão.",
      };
      try {
        if (isLocalMode()) await createTransaction(input, "import");
        else await apiPost("/transactions", input, { "X-FINNOS-Operation-ID": ["statement-import", target, row.id].join("-"), "X-FINNOS-Source": "import" });
        ok++;
      } catch { /* the summary reports it; a retry reuses the same operation IDs */ }
      setImporting({ done: ok, total });
    }
    // Merge: one record stays, with the bank's date and value (unless it is an installment)
    // and the name/category the user already had; the statement line is noted.
    for (const row of toMerge) {
      const tx = row.match.existing;
      if (!tx) continue;
      const input = inputFrom(tx);
      if (!tx.installment) { input.value = row.value; input.date = row.date; }
      input.category_id = tx.category_id ?? row.category_id;
      input.notes = [tx.notes, `Conferido com o extrato: ${row.description} (${formatDate(row.date)}, ${formatBRL(row.value)})`].filter(Boolean).join("\n");
      try { await updateTransaction(tx.id, input, "import", tx.version); ok++; } catch { /* reported below */ }
      setImporting({ done: ok, total });
    }
    await Promise.all(["transactions", "accounts", "dashboard", "cards", "flow", "calendar", "budget", "radar"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    if (ok === total) toast.success([toImport.length ? `${toImport.length} ${toImport.length === 1 ? "importada" : "importadas"}` : "", toMerge.length ? `${toMerge.length} ${toMerge.length === 1 ? "juntada" : "juntadas"}` : ""].filter(Boolean).join(" · ") + ".");
    else toast.error(`${ok} de ${total} concluídas. Tente de novo: as já salvas não serão duplicadas.`);
    setImporting(null);
    if (ok === total) { onOpenChange(false); reset(); }
  };

  const choice = (row: Row, value: Exclude<Decision, null>, label: string) => (
    <button type="button" onClick={() => decide(row.id, value)} aria-pressed={row.decision === value}
      className={cn("h-8 rounded-full px-3 text-xs font-semibold transition-colors", row.decision === value ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70")}>
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg" data-testid="statement-import-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Importar extrato ou fatura</DialogTitle>
          <DialogDescription>PDF, OFX ou CSV do app do banco. O FINNOS compara com o que você já registrou antes de salvar.</DialogDescription>
        </DialogHeader>

        <label className="block text-sm font-medium">
          Para onde vão as movimentações?
          <select value={target} onChange={(e) => { setTarget(e.target.value); setRows([]); setFileNames([]); }} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" data-testid="statement-import-target">
            <option value="">Escolha a conta ou o cartão</option>
            {accounts.length ? <optgroup label="Extrato da conta">{accounts.map((a) => <option key={a.id} value={`account:${a.id}`}>{a.name}</option>)}</optgroup> : null}
            {cards.length ? <optgroup label="Fatura do cartão">{cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}</optgroup> : null}
          </select>
        </label>

        <input ref={fileInput} type="file" multiple accept=".pdf,.ofx,.qfx,.csv,.txt,application/pdf,text/csv" className="hidden" onChange={(e) => { void readFiles(e.target.files); e.target.value = ""; }} data-testid="statement-import-file" />
        <button type="button" disabled={!target} onClick={() => fileInput.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-4 py-6 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50">
          <FileUp className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="truncate">{fileNames.length ? fileNames.join(", ") : "Escolher arquivos"}</span>
        </button>

        {rows.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={onlyRecent} onChange={(e) => setOnlyRecent(e.target.checked)} /> Só os últimos 90 dias</label>
              <span className="text-muted-foreground">{visible.length} linhas{flagged.length ? ` · ${flagged.length} parecidas` : ""}</span>
            </div>
            <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto rounded-2xl border border-border" data-testid="statement-import-rows">
              {visible.map((row) => (
                <li key={row.id} className={cn("px-3 py-2.5", row.decision === null && "bg-amber-500/5")} data-testid={`import-row-${row.match.level}`}>
                  <div className="flex items-center gap-3">
                    {row.match.level === "new" ? (
                      <input type="checkbox" aria-label={`Importar ${row.description}`} disabled={row.blocked} checked={row.decision === "import"} onChange={(e) => decide(row.id, e.target.checked ? "import" : "skip")} />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.description}</span>
                      <span className="block text-xs text-muted-foreground">{formatDate(row.date)}{row.time ? ` ${row.time}` : ""}{row.review_reason ? ` · ${row.review_reason}` : ""}</span>
                    </span>
                    <span className={cn("shrink-0 text-sm font-semibold tabular-nums", row.type === "despesa" ? "text-expense" : "text-income")}>{row.type === "despesa" ? "−" : "+"}{formatBRL(row.value)}</span>
                  </div>
                  {row.match.existing ? (
                    <div className="mt-2 rounded-xl bg-muted/60 p-2.5">
                      <p className="text-xs">
                        <span className={cn("font-semibold", row.match.level === "duplicate" ? "text-amber-600 dark:text-amber-400" : "text-primary")}>{row.match.level === "duplicate" ? "Provável duplicidade" : "Parecido com"}:</span>{" "}
                        {row.match.existing.name} · {formatDate(row.match.existing.date)} · {formatBRL(row.match.existing.value)}{row.match.existing.category_name ? ` · ${row.match.existing.category_name}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{row.match.reasons.join(" · ")}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="O que fazer com esta linha">
                        {choice(row, "skip", "É o mesmo")}
                        {choice(row, "import", "É diferente")}
                        {choice(row, "merge", "Juntar")}
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {toMerge.length ? <p className="text-xs text-muted-foreground">Juntar mantém um só lançamento, com a data e o valor do banco e o nome e a categoria que você já tinha.</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={Boolean(importing)}>Cancelar</Button>
          <Button onClick={() => void runImport()} disabled={(!toImport.length && !toMerge.length) || pending.length > 0 || Boolean(importing)} data-testid="statement-import-submit">
            {importing
              ? `Salvando ${importing.done}/${importing.total}…`
              : pending.length
                ? `Confira ${pending.length} parecida${pending.length > 1 ? "s" : ""}`
                : `Importar ${toImport.length}${toMerge.length ? ` · juntar ${toMerge.length}` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
