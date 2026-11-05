import { lazy, Suspense, useEffect, useState } from "react";
import { onStatementImportOffer } from "@/lib/importOffer";
const StatementImportDialog = lazy(() => import("@/components/import/StatementImportDialog").then((m) => ({ default: m.StatementImportDialog })));

/** One import dialog for the whole app, opened from "Importar extrato" right after a new account or card. */
export function StatementImportHost() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => onStatementImportOffer(setTarget), []);
  if (target === null) return null;
  return <Suspense fallback={null}><StatementImportDialog open initialTarget={target} onOpenChange={(open) => { if (!open) setTarget(null); }} /></Suspense>;
}
