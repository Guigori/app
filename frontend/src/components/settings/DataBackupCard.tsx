import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileUp, Upload } from "lucide-react";
import { downloadBackup, downloadTransactionsCsv, restoreBackup } from "@/lib/backup";
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
