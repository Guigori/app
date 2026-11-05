import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudUpload, Download, FileSpreadsheet, FileUp, Server, Upload } from "lucide-react";
import { downloadBackup, downloadServerBackup, downloadTransactionsCsv, listServerBackups, restoreBackup, saveServerBackup } from "@/lib/backup";
import { getApiErrorMessage } from "@/lib/errors";
import { isLocalMode } from "@/lib/mode";
import { StatementImportDialog } from "@/components/import/StatementImportDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Configurações → Dados: take the data out (backup, CSV) and bring data in (backup, statements). */
export function DataBackupCard() {
  const queryClient = useQueryClient();
  const local = isLocalMode();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<File | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const serverCopies = useQuery({ queryKey: ["server-backups"], queryFn: listServerBackups, enabled: !local });

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    try { await task(); } catch (error) { toast.error(getApiErrorMessage(error, error instanceof Error ? error.message : undefined)); } finally { setBusy(null); }
  };
  const row = "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-50";
  const icon = "grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary";

  return (
    <Card data-testid="settings-data-card">
      <CardHeader>
        <CardTitle className="font-heading">Exportar e importar</CardTitle>
        <CardDescription>Guarde uma cópia dos seus dados ou traga movimentações de outros lugares.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border border-t border-border">
          <button type="button" className={row} disabled={Boolean(busy)} onClick={() => void run("backup", async () => { await downloadBackup(); toast.success("Backup baixado."); })} data-testid="settings-download-backup">
            <span className={icon}><Download className="h-4 w-4" /></span>
            <span className="flex-1"><span className="block text-sm font-medium">{busy === "backup" ? "Preparando…" : "Baixar backup completo"}</span><span className="block text-xs text-muted-foreground">Arquivo .json com contas, cartões, categorias e lançamentos</span></span>
          </button>
          <button type="button" className={row} disabled={Boolean(busy)} onClick={() => void run("csv", async () => { const n = await downloadTransactionsCsv(); toast.success(`${n} lançamentos exportados.`); })} data-testid="settings-download-csv">
            <span className={icon}><FileSpreadsheet className="h-4 w-4" /></span>
            <span className="flex-1"><span className="block text-sm font-medium">{busy === "csv" ? "Preparando…" : "Exportar lançamentos (.csv)"}</span><span className="block text-xs text-muted-foreground">Abre no Excel, Numbers ou Planilhas</span></span>
          </button>
          <button type="button" className={row} disabled={Boolean(busy)} onClick={() => setImportOpen(true)} data-testid="settings-import-statement">
            <span className={icon}><FileUp className="h-4 w-4" /></span>
            <span className="flex-1"><span className="block text-sm font-medium">Importar extrato ou fatura</span><span className="block text-xs text-muted-foreground">OFX ou CSV do app do banco · confira antes de salvar</span></span>
          </button>
          <button type="button" className={row} disabled={Boolean(busy)} onClick={() => fileInput.current?.click()} data-testid="settings-restore-backup">
            <span className={icon}><Upload className="h-4 w-4" /></span>
            <span className="flex-1"><span className="block text-sm font-medium">{busy === "restore" ? "Restaurando…" : "Restaurar backup"}</span><span className="block text-xs text-muted-foreground">{local ? "Substitui os dados deste aparelho" : "Somente em uma conta sem dados"}</span></span>
          </button>
        </div>
        {!local ? (
          <div className="border-t border-border px-4 py-4" data-testid="settings-server-backups">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium"><Server className="h-4 w-4 text-primary" />Cópias guardadas no servidor</p>
              <button type="button" disabled={Boolean(busy)} onClick={() => void run("snapshot", async () => { await saveServerBackup(); await serverCopies.refetch(); toast.success("Cópia guardada no servidor."); })}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50" data-testid="settings-save-server-backup">
                <CloudUpload className="h-4 w-4" />{busy === "snapshot" ? "Guardando…" : "Guardar agora"}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Toda segunda-feira o FINNOS guarda uma cópia e mantém as {serverCopies.data?.keep ?? 8} mais recentes.</p>
            {serverCopies.isPending ? <p className="mt-3 text-xs text-muted-foreground">Carregando…</p> : serverCopies.isError ? <p className="mt-3 text-xs text-destructive">Não foi possível listar as cópias.</p> : serverCopies.data?.items.length ? (
              <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
                {serverCopies.data.items.map((copy) => (
                  <li key={copy.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{new Date(copy.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="block text-xs text-muted-foreground">{copy.source === "semanal" ? "Semanal" : "Manual"} · {copy.counts.transactions ?? 0} lançamentos · {Math.max(1, Math.round(copy.bytes / 1024))} KB</span>
                    </span>
                    <button type="button" disabled={Boolean(busy)} onClick={() => void run(`dl-${copy.id}`, () => downloadServerBackup(copy.id))} className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted" aria-label="Baixar esta cópia"><Download className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-xs text-muted-foreground">Nenhuma cópia ainda. A primeira é feita na próxima segunda, ou agora em "Guardar agora".</p>}
          </div>
        ) : null}
        <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { setPendingRestore(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      </CardContent>
      <StatementImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={pendingRestore !== null}
        onOpenChange={(open) => { if (!open) setPendingRestore(null); }}
        title="Restaurar este backup?"
        description={local ? "Os dados atuais deste aparelho serão substituídos pelos do arquivo." : "Os dados do arquivo serão gravados na sua conta. Isso só funciona em uma conta ainda sem contas e lançamentos."}
        confirmLabel="Restaurar"
        destructive={local}
        loading={busy === "restore"}
        onConfirm={() => { const file = pendingRestore; if (!file) return; void run("restore", async () => { const out = await restoreBackup(file); setPendingRestore(null); await queryClient.invalidateQueries(); toast.success(`Backup restaurado (${out.restored.transactions ?? 0} lançamentos).`); }); }}
      />
    </Card>
  );
}
