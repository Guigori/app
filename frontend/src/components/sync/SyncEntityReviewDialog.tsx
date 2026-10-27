import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { discardConflictedOperation, type SyncOperation } from "@/lib/sync/queue";

const LABELS: Record<string, string> = {
  "account.create": "conta",
  "category.create": "categoria",
  "card.create": "cartão",
  "subscription.create": "assinatura",
};

/** An offline entity creation must never be offered a transaction editor.
 * This review is read-only: retry preserves its idempotent operation ID;
 * discarding only removes the unsent copy, never a server document.
 */
export function SyncEntityReviewDialog({
  operation, onClose,
}: {
  operation: SyncOperation | null;
  onClose: () => void;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = operation ? LABELS[operation.kind] ?? "cadastro" : "cadastro";
  const data = operation?.payload as { name?: string } | undefined;
  const discard = async () => {
    if (!operation) return;
    setDiscarding(true);
    try {
      await discardConflictedOperation(operation.id);
      setConfirmDiscard(false);
      toast.warning("Cópia local descartada após revisão", {
        description: "Isso não altera nenhum cadastro que já exista no servidor.",
      });
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Não foi possível concluir a revisão.");
    } finally {
      setDiscarding(false);
    }
  };
  return (
    <>
      <Dialog open={Boolean(operation)} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revisar cadastro de {label} pendente</DialogTitle>
            <DialogDescription>
              Este cadastro ainda não foi confirmado. Verifique se ele já aparece em sua conta
              antes de descartar a tentativa local. Operações posteriores estão protegidas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-xl border p-3 text-sm">
            <p className="font-medium">{data?.name ?? "Cadastro sem nome"}</p>
            <p className="text-xs text-muted-foreground">
              Tipo: {label} · Tentativas: {operation?.attempts ?? 0}
            </p>
            {operation?.lastError && <p className="text-destructive">{operation.lastError}</p>}
            {error && <p role="alert" className="text-destructive">{error}</p>}
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={async () => {
              try {
                await navigator.clipboard.writeText(JSON.stringify(operation?.payload, null, 2));
                toast.success("Dados da tentativa copiados.");
              } catch { setError("Não foi possível copiar os dados."); }
            }}>Copiar dados</Button>
            <Button variant="ghost" onClick={onClose}>Voltar</Button>
            {operation?.status === "conflict" && (
              <Button variant="destructive" onClick={() => setConfirmDiscard(true)}>
                Descartar tentativa local
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Descartar cadastro pendente?"
        description="Isso exclui somente a cópia pendente neste aparelho. Não apaga registros no servidor. Se o servidor não recebeu o cadastro, a informação será perdida. Confirme somente após consultar e copiar os dados."
        confirmLabel="Descartar tentativa"
        destructive
        loading={discarding}
        onConfirm={() => { void discard(); }}
      />
    </>
  );
}
