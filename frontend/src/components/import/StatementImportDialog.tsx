import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { apiPost } from "@/lib/api";
import { createTransaction, fetchAccounts, fetchCards, fetchTransactions } from "@/lib/data";
import { formatBRL, formatDate } from "@/lib/format";
import { parseFinancialFile, type ImportRow } from "@/lib/importFinancial";
import { isLocalMode } from "@/lib/mode";
import { daysAgoISO, fingerprint, isLikelyDuplicate } from "@/lib/statementImport";
import type { TransactionInput } from "@/types/finnos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Row extends ImportRow {
  duplicate: boolean;
}

/** Bring the last 90 days from bank statements and card invoices (OFX, QFX, CSV, TXT).
 *  Every line is reviewed before saving; likely duplicates start unchecked, and the
 *  same file always maps to the same operation IDs, so importing twice never duplicates. */
export function StatementImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled: open });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards, enabled: open });
  const accounts = (accountsQuery.data ?? []).filter((a) => a.active);
  const cards = (cardsQuery.data ?? []).filter((c) => c.active);
  const [target, setTarget] = useState("");
  const [onlyRecent, setOnlyRecent] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const targetCard = cards.find((c) => `card:${c.id}` === target);
  const targetAccount = accounts.find((a) => `account:${a.id}` === target);
  const since = daysAgoISO(90);
  const visible = useMemo(() => rows.filter((r) => !onlyRecent || r.date >= since), [rows, onlyRecent, since]);
  const chosen = visible.filter((r) => r.selected && !r.blocked);

  const reset = () => { setRows([]); setFileNames([]); setImporting(null); };
  const close = (next: boolean) => { if (importing) return; onOpenChange(next); if (!next) reset(); };

  const readFiles = async (files: FileList | null) => {
    if (!files?.length || (!targetCard && !targetAccount)) return;
    const parsed: ImportRow[] = [];
    for (const file of Array.from(files)) {
      if (!/\.(csv|ofx|qfx|txt)$/i.test(file.name)) { toast.info(`${file.name}: use OFX, QFX, CSV ou TXT. PDF ainda não é lido.`); continue; }
      const text = await file.text();
      const digest = await fingerprint(text);
      const lines = parseFinancialFile(text, targetCard ? "invoice" : "statement");
      if (lines.length === 0) toast.error(`${file.name}: não encontrei movimentações.`);
      parsed.push(...lines.map((row, index) => ({ ...row, id: `${digest.slice(0, 32)}-${index}` })));
    }
    const dates = parsed.map((r) => r.date).sort();
    const existing = dates.length
      ? await fetchTransactions({ start_date: dates[0], end_date: dates[dates.length - 1], ...(targetAccount ? { account_id: targetAccount.id } : {}) }).catch(() => [])
      : [];
    setRows(parsed.map((row) => {
      const duplicate = isLikelyDuplicate(row, existing);
      return { ...row, duplicate, selected: row.selected && !duplicate && !row.blocked };
    }));
    setFileNames(Array.from(files).map((f) => f.name));
  };

  const runImport = async () => {
    const accountId = targetAccount?.id ?? targetCard?.payment_account_id ?? accounts[0]?.id;
    if (!accountId) { toast.error("Cadastre uma conta antes de importar."); return; }
    setImporting({ done: 0, total: chosen.length });
    let ok = 0;
    for (const row of chosen) {
      const input: TransactionInput = {
        name: row.description.trim().slice(0, 100) || "Movimentação importada",
        value: row.value,
        type: row.type,
        status: "pago",
        date: row.date,
        account_id: accountId,
        card_id: targetCard ? targetCard.id : null,
        to_account_id: null,
        category_id: row.category_id,
        fixed: false,
        recurrence: null,
        installment: false,
        total_installments: null,
        current_installment: null,
        adjusted_value: null,
        attachment: null,
        notes: "Importado de extrato após revisão.",
      };
      try {
        if (isLocalMode()) await createTransaction(input, "import");
        else await apiPost("/transactions", input, { "X-FINNOS-Operation-ID": ["statement-import", target, row.id].join("-"), "X-FINNOS-Source": "import" });
        ok++;
      } catch {
        // Keep going: the summary says how many were saved, and a retry reuses the same operation IDs.
      }
      setImporting({ done: ok, total: chosen.length });
    }
    await Promise.all(["transactions", "accounts", "dashboard", "cards", "flow", "calendar", "budget", "radar"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    if (ok === chosen.length) toast.success(`${ok} movimentações importadas.`);
    else toast.error(`${ok} de ${chosen.length} importadas. Tente de novo: as já salvas não serão duplicadas.`);
    setImporting(null);
    if (ok === chosen.length) { onOpenChange(false); reset(); }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg" data-testid="statement-import-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Importar extrato ou fatura</DialogTitle>
          <DialogDescription>Exporte o OFX ou CSV no app do banco. Você confere cada linha antes de salvar.</DialogDescription>
        </DialogHeader>

        <label className="block text-sm font-medium">
          Para onde vão as movimentações?
          <select value={target} onChange={(e) => { setTarget(e.target.value); setRows([]); setFileNames([]); }} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" data-testid="statement-import-target">
            <option value="">Escolha a conta ou o cartão</option>
            {accounts.length ? <optgroup label="Extrato da conta">{accounts.map((a) => <option key={a.id} value={`account:${a.id}`}>{a.name}</option>)}</optgroup> : null}
            {cards.length ? <optgroup label="Fatura do cartão">{cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}</optgroup> : null}
          </select>
        </label>

        <input ref={fileInput} type="file" multiple accept=".ofx,.qfx,.csv,.txt,text/csv" className="hidden" onChange={(e) => { void readFiles(e.target.files); e.target.value = ""; }} data-testid="statement-import-file" />
        <button type="button" disabled={!target} onClick={() => fileInput.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-4 py-6 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50">
          <FileUp className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="truncate">{fileNames.length ? fileNames.join(", ") : "Escolher arquivos"}</span>
        </button>

        {rows.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={onlyRecent} onChange={(e) => setOnlyRecent(e.target.checked)} /> Só os últimos 90 dias</label>
              <span className="text-muted-foreground">{chosen.length} de {visible.length}</span>
            </div>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-2xl border border-border" data-testid="statement-import-rows">
              {visible.map((row) => (
                <li key={row.id}>
                  <label className={cn("flex items-center gap-3 px-3 py-2.5", row.blocked ? "opacity-60" : "cursor-pointer")}>
                    <input type="checkbox" disabled={row.blocked} checked={row.selected && !row.blocked} onChange={(e) => setRows((all) => all.map((r) => r.id === row.id ? { ...r, selected: e.target.checked } : r))} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.description}</span>
                      <span className="block text-xs text-muted-foreground">{formatDate(row.date)}{row.duplicate ? " · parece já registrado" : row.review_reason ? ` · ${row.review_reason}` : ""}</span>
                    </span>
                    <span className={cn("shrink-0 text-sm font-semibold tabular-nums", row.type === "despesa" ? "text-expense" : "text-income")}>{row.type === "despesa" ? "−" : "+"}{formatBRL(row.value)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={Boolean(importing)}>Cancelar</Button>
          <Button onClick={() => void runImport()} disabled={!chosen.length || Boolean(importing)} data-testid="statement-import-submit">
            {importing ? `Importando ${importing.done}/${importing.total}…` : chosen.length ? `Importar ${chosen.length}` : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
