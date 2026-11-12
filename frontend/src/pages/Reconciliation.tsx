import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ScreenHeader } from "@/components/layout/BackButton";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { AdjustBalanceDialog } from "@/components/accounts/AdjustBalanceDialog";
import { TransactionDialog } from "@/components/transactions/TransactionDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  completeReconciliation, createReconciliation, fetchAccountReconciliations, fetchAccounts, fetchReconciliation,
  fetchTransactions, resolveReconciliation, undoReconciliationEvent,
} from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, formatDate, parseAmount, todayISO } from "@/lib/format";
import { ofxClosingBalance, parseFinancialFile } from "@/lib/importFinancial";
import { pdfToStatementCsv } from "@/lib/pdfStatement";
import { daysAgoISO, fingerprint } from "@/lib/statementImport";
import { cn } from "@/lib/utils";
import type { Account, ReconLine, Reconciliation as Recon, ReconResolveInput, TransactionInput } from "@/types/finnos";

type Filter = "tudo" | "bateu" | "revisar" | "nao";
const money = (cents: number) => formatBRL(cents / 100);
const LEVEL_LABEL: Record<ReconLine["level"], string> = {
  strong: "Bateu", already: "Já conferida", linked: "Bateu", probable: "Provável", value_diff: "Valor diferente", only_statement: "Só no extrato",
};
const ACTION_LABEL: Record<string, string> = {
  confirm: "confirmou", separate: "separou", use_bank_value: "usou o valor do banco", keep_value: "manteve o valor do FINNOS",
  link: "registrou e ligou", ignore: "ignorou", keep: "manteve", keep_pending: "marcou como ainda vai cair", delete: "excluiu", undo: "desfez",
};

export default function Reconciliation() {
  const { accountId = "" } = useParams();
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const account = accountsQuery.data?.find((a) => a.id === accountId);
  const listQuery = useQuery({ queryKey: ["reconciliations", accountId], queryFn: () => fetchAccountReconciliations(accountId), enabled: Boolean(accountId) });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [startNew, setStartNew] = useState(false);
  const activeId = currentId ?? (startNew ? null : listQuery.data?.find((r) => r.status === "pronta")?.id ?? null);
  const recQuery = useQuery({ queryKey: ["reconciliation", activeId], queryFn: () => fetchReconciliation(activeId!), enabled: Boolean(activeId) });
  const rec = recQuery.data;

  const refresh = async (next?: Recon) => {
    if (next) queryClient.setQueryData(["reconciliation", next.id], (old: Recon | undefined) => ({ ...old, ...next }));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reconciliation", activeId] }),
      queryClient.invalidateQueries({ queryKey: ["reconciliations", accountId] }),
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };

  if (accountsQuery.isPending || listQuery.isPending) return <FinnosPageLoading />;
  if (!account) return <p className="p-6 text-sm text-muted-foreground">Conta não encontrada.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24">
      <ScreenHeader title="Conferir com extrato" keepSubtitle
        subtitle={<span data-testid="recon-account">{account.name}{account.reconciled_until ? ` · conferida até ${formatDate(account.reconciled_until)}` : ""}</span>} />
      {rec && !startNew ? (
        <ReconView rec={rec} account={account} onChanged={refresh}
          onNew={() => { setStartNew(true); setCurrentId(null); }} />
      ) : (
        <UploadCard accountId={account.id} onCreated={(created) => { setStartNew(false); setCurrentId(created.id); void refresh(created); }} />
      )}
    </div>
  );
}

function UploadCard({ accountId, onCreated }: { accountId: string; onCreated: (rec: Recon) => void }) {
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

  return (
    <section className="space-y-4 rounded-3xl border border-border p-5" data-testid="recon-upload">
      <div>
        <h2 className="font-heading text-lg font-bold">Anexe o extrato do banco</h2>
        <p className="text-sm text-muted-foreground">O FINNOS compara cada linha com o que está registrado nesta conta. Nada muda sem você decidir.</p>
      </div>
      <div className="flex gap-2" role="radiogroup" aria-label="Período">
        {([30, 60, 90] as const).map((d) => (
          <Button key={d} type="button" size="sm" variant={days === d ? "default" : "outline"} role="radio" aria-checked={days === d}
            onClick={() => setDays(d)} data-testid={`recon-days-${d}`}>{d} dias</Button>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor="recon-closing">Saldo no banco hoje (opcional; o OFX já traz)</Label>
        <Input id="recon-closing" inputMode="decimal" placeholder="Ex.: 2.111,45" value={closingRaw} onChange={(e) => setClosingRaw(e.target.value)} data-testid="recon-closing-input" />
      </div>
      <input ref={input} type="file" accept=".ofx,.qfx,.csv,.txt,.pdf,image/*" className="hidden" onChange={(e) => void read(e.target.files?.[0])} data-testid="recon-file-input" />
      <Button onClick={() => input.current?.click()} disabled={busy} className="h-11 w-full rounded-2xl" data-testid="recon-attach">
        <FileUp className="h-4 w-4" aria-hidden="true" />{busy ? "Lendo o extrato…" : "Anexar OFX, CSV ou PDF"}
      </Button>
      {status ? <p role="alert" className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm" data-testid="recon-upload-status">{status}</p> : null}
    </section>
  );
}

function ReconView({ rec, account, onChanged, onNew }: {
  rec: Recon; account: Account; onChanged: (next?: Recon) => Promise<void>; onNew: () => void;
}) {
  const accountId = account.id;
  const accountName = account.name;
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
    mutationFn: () => completeReconciliation(rec.id),
    onSuccess: (next) => { toast.success(`Conta conferida até ${formatDate(rec.period_end)}.`); return onChanged(next); },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  const bank = rec.bank_closing_cents;
  const diff = bank == null ? null : bank - rec.finnos_closing_cents;
  const visible = rec.lines.filter((l) => filter === "tudo" || (filter === "bateu" && l.state === "matched")
    || (filter === "revisar" && l.state === "review") || (filter === "nao" && (l.state === "open" || l.state === "ignored")));
  const prefill: Partial<TransactionInput> | undefined = registerLine ? {
    type: registerLine.direction === "in" ? "receita" : "despesa", name: registerLine.description, value: registerLine.cents / 100,
    date: registerLine.date, status: "pago", account_id: accountId, notes: "Registrado na conferência com o extrato.",
  } : undefined;

  return (
    <div className="space-y-5" data-testid="recon-view">
      <section className="grid grid-cols-3 gap-2 rounded-3xl bg-primary/5 p-4 text-center" data-testid="recon-balances">
        <div><p className="text-xs text-muted-foreground">Banco</p><p className="font-heading font-bold tabular-nums" data-testid="recon-bank">{bank == null ? "—" : money(bank)}</p></div>
        <div><p className="text-xs text-muted-foreground">FINNOS</p><p className="font-heading font-bold tabular-nums" data-testid="recon-finnos">{money(rec.finnos_closing_cents)}</p></div>
        <div><p className="text-xs text-muted-foreground">Diferença</p>
          <p className={cn("font-heading font-bold tabular-nums", diff ? "text-expense" : "text-income")} data-testid="recon-diff">{diff == null ? "—" : money(diff)}</p></div>
        <p className="col-span-3 text-xs text-muted-foreground">
          {formatDate(rec.period_start)} a {formatDate(rec.period_end)} · {rec.file_name || "extrato"} · {rec.lines.length} linhas
        </p>
      </section>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar linhas">
        {([["tudo", "Tudo", rec.lines.length], ["bateu", "Bateu", rec.counts.matched ?? 0], ["revisar", "Revisar", rec.counts.review ?? 0],
          ["nao", "Não bateu", (rec.counts.open ?? 0) + (rec.counts.ignored ?? 0)]] as const).map(([key, label, count]) => (
          <Button key={key} size="sm" variant={filter === key ? "default" : "outline"} role="tab" aria-selected={filter === key}
            onClick={() => setFilter(key)} data-testid={`recon-filter-${key}`}>{label} · {count}</Button>
        ))}
      </div>

      <ul className="divide-y divide-border rounded-3xl border border-border" data-testid="recon-lines">
        {visible.map((line) => {
          const tx = line.tx_id ? names.get(line.tx_id) : undefined;
          return (
            <li key={line.index} className="space-y-2 p-4" data-testid={`recon-line-${line.index}`} data-state={line.state}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{line.description}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(line.date)}{tx ? ` · no FINNOS: ${tx.name} (${formatBRL(tx.value)})` : ""}</p>
                  {line.reasons.length ? <p className="text-xs text-muted-foreground">{line.reasons.join(" · ")}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn("text-sm font-bold tabular-nums", line.direction === "in" ? "text-income" : "text-expense")}>
                    {line.direction === "in" ? "+" : "−"}{money(line.cents)}
                  </p>
                  <Badge variant={line.state === "matched" ? "secondary" : line.state === "review" ? "outline" : "destructive"}>
                    {line.state === "ignored" ? "Ignorada" : line.state === "matched" ? (line.kept_difference ? "Mantido" : LEVEL_LABEL[line.level]) : LEVEL_LABEL[line.level]}
                  </Badge>
                </div>
              </div>
              {!done && line.state === "review" && line.level === "probable" ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => resolve.mutate({ line: line.index, action: "confirm" })} data-testid={`recon-confirm-${line.index}`}>É o mesmo</Button>
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate({ line: line.index, action: "separate" })} data-testid={`recon-separate-${line.index}`}>São diferentes</Button>
                </div>
              ) : null}
              {!done && line.state === "review" && line.level === "value_diff" ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => resolve.mutate({ line: line.index, action: "use_bank_value" })} data-testid={`recon-bank-value-${line.index}`}>Usar o valor do banco</Button>
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate({ line: line.index, action: "keep_value" })} data-testid={`recon-keep-value-${line.index}`}>Manter o do FINNOS</Button>
                </div>
              ) : null}
              {!done && line.state === "open" ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setRegisterLine(line)} data-testid={`recon-register-${line.index}`}>Registrar</Button>
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate({ line: line.index, action: "ignore" })} data-testid={`recon-ignore-${line.index}`}>Ignorar</Button>
                </div>
              ) : null}
            </li>
          );
        })}
        {visible.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">Nada neste filtro.</li> : null}
      </ul>

      {rec.finnos.length ? (
        <section className="space-y-2" data-testid="recon-finnos-only">
          <h2 className="text-sm font-semibold">Só no FINNOS ({rec.finnos.filter((f) => f.state === "open").length} para decidir)</h2>
          <ul className="divide-y divide-border rounded-3xl border border-border">
            {rec.finnos.map((item) => {
              const tx = names.get(item.tx_id);
              return (
                <li key={item.tx_id} className="space-y-2 p-4" data-testid={`recon-finnos-${item.tx_id}`} data-state={item.state}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{tx?.name ?? "Lançamento"}</p>
                      <p className="text-xs text-muted-foreground">{tx ? formatDate(tx.date) : ""}{item.repeated_of ? " · parece repetido" : ""}</p>
                    </div>
                    <p className="shrink-0 text-sm font-bold tabular-nums">{tx ? formatBRL(tx.value) : ""}</p>
                  </div>
                  {!done && item.state === "open" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => resolve.mutate({ tx_id: item.tx_id, action: "keep_pending" })} data-testid={`recon-pending-${item.tx_id}`}>Ainda vai cair</Button>
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

      {rec.history?.length ? (
        <section className="space-y-2" data-testid="recon-history">
          <h2 className="text-sm font-semibold">Histórico</h2>
          <ul className="space-y-1 text-sm">
            {rec.history.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-muted/50">
                <span className={cn(event.undone_by && "line-through text-muted-foreground")}>
                  Você {ACTION_LABEL[event.action] ?? event.action} · {event.target.startsWith("line:") ? `linha ${Number(event.target.slice(5)) + 1}` : "lançamento do FINNOS"}
                </span>
                {!done && !event.undone_by && !event.undo_of ? (
                  <Button size="sm" variant="ghost" disabled={undo.isPending} onClick={() => undo.mutate(event.id)} data-testid={`recon-undo-${event.seq}`}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />Desfazer
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="sticky bottom-4 space-y-2 rounded-3xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur">
        {done ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-income" data-testid="recon-done">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{accountName} conferida até {formatDate(rec.period_end)}.
          </p>
        ) : rec.pending ? (
          <p className="text-sm text-muted-foreground" data-testid="recon-pending-count">Faltam {rec.pending} decisão(ões) para concluir.</p>
        ) : diff ? (
          <p className="text-sm" data-testid="recon-diff-left">Tudo decidido, mas os saldos ainda diferem em {money(diff)}.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Tudo decidido. Os saldos batem.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {!done ? (
            <Button disabled={rec.pending > 0 || complete.isPending || Boolean(diff)} onClick={() => complete.mutate()} data-testid="recon-complete">Concluir conferência</Button>
          ) : null}
          {!done && diff && !rec.pending ? (
            <Button variant="outline" onClick={() => setAdjusting(true)} data-testid="recon-adjust">Corrigir o saldo</Button>
          ) : null}
          <Button variant="ghost" onClick={onNew} data-testid="recon-new">Nova conferência</Button>
        </div>
      </div>

      <AdjustBalanceDialog open={adjusting} onOpenChange={setAdjusting} account={account} suggested={bank == null ? null : bank / 100}
        date={rec.period_end} reconciliationId={rec.id} onDone={() => void onChanged()} />
      <TransactionDialog open={Boolean(registerLine)} onOpenChange={(open) => { if (!open) setRegisterLine(null); }} prefill={prefill}
        onSaved={(tx) => { const line = registerLine; setRegisterLine(null); if (line) resolve.mutate({ line: line.index, action: "link", tx_id: tx.id }); }} />
    </div>
  );
}
