import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adjustAccountBalance } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, parseAmount, todayISO } from "@/lib/format";
import type { Account, BalanceAdjustment } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "Só corrigir o saldo": an auditable adjustment with a required reason (etapa 3). */
export function AdjustBalanceDialog({ open, onOpenChange, account, suggested, date, reconciliationId, onDone }: {
  open: boolean; onOpenChange: (open: boolean) => void; account: Account;
  suggested?: number | null; date?: string; reconciliationId?: string | null; onDone?: (result: BalanceAdjustment) => void;
}) {
  const queryClient = useQueryClient();
  const [targetRaw, setTargetRaw] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (!open) return;
    setTargetRaw(suggested != null ? String(suggested).replace(".", ",") : "");
    setReason(reconciliationId ? "Diferença encontrada na conferência com o extrato" : "");
    setError(null);
    setOperationId(crypto.randomUUID());
  }, [open, suggested, reconciliationId]);

  const mutation = useMutation({
    mutationFn: (target: number) => adjustAccountBalance(account.id, {
      target_balance: target, reason: reason.trim(), date: date ?? todayISO(), reconciliation_id: reconciliationId ?? null,
    }, operationId),
    onSuccess: async (result) => {
      toast.success(`Saldo ajustado: ${formatBRL(result.previous_balance)} → ${formatBRL(result.new_balance)}.`);
      await Promise.all(["accounts", "account", "transactions", "dashboard", "flow", "reconciliation"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      onDone?.(result);
      onOpenChange(false);
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="adjust-balance-dialog">
        <DialogHeader>
          <DialogTitle>Corrigir o saldo de {account.name}</DialogTitle>
          <DialogDescription>
            O FINNOS cria um ajuste com a diferença. Ele fica no histórico, com o motivo, e não entra em gastos nem em receitas.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          const target = parseAmount(targetRaw);
          if (target === null) return setError("Informe o saldo correto.");
          if (reason.trim().length < 3) return setError("Explique o motivo do ajuste.");
          mutation.mutate(target);
        }}>
          <div className="space-y-2">
            <Label htmlFor="adjust-target">Saldo correto em {date ? date.split("-").reverse().join("/") : "hoje"} (R$)</Label>
            <Input id="adjust-target" inputMode="decimal" value={targetRaw} onChange={(e) => setTargetRaw(e.target.value)} data-testid="adjust-target-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjust-reason">Motivo</Label>
            <Input id="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} data-testid="adjust-reason-input" />
          </div>
          {error ? <p role="alert" className="text-sm text-destructive" data-testid="adjust-error">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="adjust-submit">Ajustar saldo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
