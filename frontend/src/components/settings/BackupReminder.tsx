import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { backupReminderDue, downloadBackup, snoozeBackupReminder } from "@/lib/backup";
import { getApiErrorMessage } from "@/lib/errors";
import { isLocalMode } from "@/lib/mode";

/** A quiet card on Início when it is time to keep a copy of your data with you. */
export function BackupReminder() {
  const [visible, setVisible] = useState(() => backupReminderDue());
  const [busy, setBusy] = useState(false);
  if (!visible) return null;
  const local = isLocalMode();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4" role="status" data-testid="backup-reminder">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></span>
      <p className="min-w-0 flex-1 text-sm">{local ? "Seus dados ficam só neste aparelho. Guarde uma cópia com você." : "Faz um tempo que você não baixa uma cópia dos seus dados."}</p>
      <div className="flex gap-2">
        <button type="button" className="h-9 rounded-full px-3 text-sm text-muted-foreground hover:bg-muted" onClick={() => { snoozeBackupReminder(); setVisible(false); }}>Depois</button>
        <button type="button" disabled={busy} className="h-9 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          onClick={async () => { setBusy(true); try { await downloadBackup(); setVisible(false); toast.success("Cópia baixada."); } catch (error) { toast.error(getApiErrorMessage(error)); } finally { setBusy(false); } }}>
          {busy ? "Preparando…" : "Baixar cópia"}
        </button>
      </div>
    </div>
  );
}
