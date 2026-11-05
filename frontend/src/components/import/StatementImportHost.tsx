import { useEffect, useState } from "react";
import { onStatementImportOffer } from "@/lib/importOffer";
import { StatementImportDialog } from "@/components/import/StatementImportDialog";

/** One import dialog for the whole app, opened from "Importar extrato" right after a new account or card. */
export function StatementImportHost() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => onStatementImportOffer(setTarget), []);
  return <StatementImportDialog open={target !== null} initialTarget={target ?? undefined} onOpenChange={(open) => { if (!open) setTarget(null); }} />;
}
