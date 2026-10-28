import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { editRecurrence, type RecurrenceEditScope } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { parseAmount, todayISO } from "@/lib/format";
import type { Transaction } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function nextOccurrence(transaction: Transaction): string {
  const today = todayISO();
  const reference = transaction.date > today ? transaction.date : today;
  const [year, month] = reference.slice(0, 7).split("-").map(Number);
  const originalDay = Number(transaction.date.slice(8, 10));
  const next = new Date(Date.UTC(year, month, 1));
  const maxDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(originalDay, maxDay)).padStart(2, "0")}`;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction;
  onSaved?: () => void;
};

export function RecurrenceScopeDialog({ open, onOpenChange, transaction, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<RecurrenceEditScope>("proximas");
  const [effectiveDate, setEffectiveDate] = useState(() => nextOccurrence(transaction));
  const [name, setName] = useState(transaction.name);
  const [amount, setAmount] = useState(String(transaction.value));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<string | null>(null);
  const payloadKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const canEditAll = transaction.status !== "pago" && transaction.date >= todayISO();
  useEffect(() => {
    if (!open) return;
    setScope("proximas");
    setEffectiveDate(nextOccurrence(transaction));
    setName(transaction.name);
    setAmount(String(transaction.value));
    setError("");
    operation.current = null;
    payloadKey.current = null;
  }, [open, transaction]);

  const submit = async () => {
    if (inFlight.current) return;
    if (!transaction.fixed || !transaction.recurrence_id || transaction.installment) {
      setError("A série precisa de um identificador estável antes desta edição.");
      return;
    }
    if (!navigator.onLine) {
      setError("A edição de séries requer conexão. Nenhuma alteração foi enviada.");
      return;
    }
    const value = parseAmount(amount);
    if (!name.trim() || value === null || value <= 0) {
      setError("Preencha o nome e um valor válido.");
      return;
    }
    const date = scope === "todas" ? transaction.date : effectiveDate;
    if (date < todayISO()) {
      setError("Escolha uma ocorrência futura.");
      return;
    }
    if (scope === "todas" && !canEditAll) {
      setError("Não é possível modificar meses já pagos. Use próximas ocorrências.");
      return;
    }
    const changes: { name?: string; value?: number } = {};
    if (name.trim() !== transaction.name) changes.name = name.trim();
    if (Math.round(value * 100) !== Math.round(transaction.value * 100)) changes.value = value;
    if (!Object.keys(changes).length) {
      setError("Altere o nome ou o valor para registrar uma edição.");
      return;
    }
    const key = JSON.stringify({ scope, date, changes });
    // Reusing the operation ID is mandatory after a lost HTTP response.
    // Do not silently change the content of an attempted financial mutation.
    if (operation.current && payloadKey.current !== key) {
      setError("Esta tentativa já foi enviada. Reabra a edição e confira o histórico antes de enviar outros valores.");
      return;
    }
    if (!operation.current) {
      operation.current = crypto.randomUUID();
      payloadKey.current = key;
    }
    inFlight.current = true;
    setWorking(true);
    setError("");
    try {
      await editRecurrence(transaction.id, transaction.version ?? 1, scope, date, changes, operation.current);
      await Promise.all(["transactions", "dashboard", "flow", "calendar", "budget", "radar", "trends", "notifications"].map(
        (key) => queryClient.invalidateQueries({ queryKey: [key] }),
      ));
      toast.success("Recorrência atualizada com segurança.");
      onOpenChange(false);
      onSaved?.();
    } catch (cause) {
      setError(getApiErrorMessage(cause));
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!working) onOpenChange(next); }}>
    <DialogContent className="sm:max-w-md" data-testid="recurrence-scope-dialog">
      <DialogHeader>
        <DialogTitle>Editar recorrência mensal</DialogTitle>
        <DialogDescription>
          O histórico pago permanece inalterado. A edição por período não modifica outros campos do lançamento.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Aplicar alteração</legend>
          {([
            ["esta", "Somente esta ocorrência", "Cria uma exceção nesta data."],
            ["proximas", "Esta e as próximas", "Altera as previsões a partir desta data."],
            ["todas", "Toda a série futura", "Permitido apenas para séries sem histórico pago."],
          ] as const).map(([value, label, hint]) => (
            <label key={value} className="flex cursor-pointer gap-3 rounded-xl border p-3 text-sm">
              <input type="radio" name="recurrence-scope" value={value}
                checked={scope === value} disabled={value === "todas" && !canEditAll}
                onChange={() => setScope(value)} />
              <span><span className="block font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
            </label>
          ))}
        </fieldset>
        {scope !== "todas" && <div className="space-y-1">
          <Label htmlFor="recurrence-date">Data da ocorrência</Label>
          <Input id="recurrence-date" type="date" min={todayISO()} value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)} data-testid="recurrence-date" />
        </div>}
        <div className="space-y-1">
          <Label htmlFor="recurrence-name">Nome</Label>
          <Input id="recurrence-name" value={name} maxLength={80}
            onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="recurrence-value">Valor (R$)</Label>
          <Input id="recurrence-value" value={amount} inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={working} onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button type="button" disabled={working} onClick={() => void submit()} data-testid="recurrence-save">Salvar recorrência</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
