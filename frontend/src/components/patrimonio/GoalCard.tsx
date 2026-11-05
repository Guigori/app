import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PiggyBank } from "lucide-react";
import { updateGoal, type FinnosGoal } from "@/lib/goals";
import { addDeposit, goalProgress } from "@/lib/goalProgress";
import { formatDate, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Account } from "@/types/finnos";

/** One goal: progress, whether it is on pace, and a quick "Guardar" to record a contribution. */
export function GoalCard({ goal, userId, accounts, display, onEdit, onSaved }: {
  goal: FinnosGoal;
  userId: string;
  accounts: Account[];
  display: (n: number) => string;
  onEdit: () => void;
  onSaved: () => void;
}) {
  const account = accounts.find((a) => a.id === goal.account);
  const progress = goalProgress(goal, account ? account.balance : null, todayISO());
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState(String(goal.contribution || ""));
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    const value = Number(amount.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    try {
      await updateGoal(userId, addDeposit(goal, value, todayISO()));
      toast.success(`${display(Math.min(value, goal.target - goal.saved))} guardados em ${goal.name}.`);
      setAdding(false);
      onSaved();
    } catch {
      toast.error("Não foi possível registrar o aporte.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-4" data-testid={`goal-${goal.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-primary">{goal.mode === "inteligente" ? "✦ Meta Inteligente" : "Meta"}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", progress.status === "concluida" ? "bg-income/10 text-income" : progress.status === "no-ritmo" ? "bg-primary/10 text-primary" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
          {progress.status === "concluida" ? "Concluída" : progress.status === "no-ritmo" ? "No ritmo" : `Atrasada ${display(progress.behindBy)}`}
        </span>
      </div>
      <h3 className="mt-2 font-heading font-bold">{goal.name}</h3>
      <p className="mt-1 text-sm tabular-nums">{display(progress.saved)} de {display(goal.target)}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
      <p className="mt-2 text-xs text-muted-foreground">
        {progress.percent.toFixed(0)}% · {progress.tracking ? `acompanhando o saldo de ${account?.name}` : `${display(goal.contribution)} por aporte (${goal.frequency.toLowerCase()})`}
        {progress.lastDeposit ? ` · último aporte ${formatDate(progress.lastDeposit.date)}` : ""}
      </p>
      {adding ? (
        <form onSubmit={save} className="mt-3 flex items-center gap-2">
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Valor do aporte" className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm" />
          <button type="submit" disabled={busy} className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "…" : "Guardar"}</button>
          <button type="button" onClick={() => setAdding(false)} className="h-10 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          {!progress.tracking && progress.status !== "concluida" ? (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground" data-testid="goal-deposit-button"><PiggyBank className="h-4 w-4" />Guardar</button>
          ) : null}
          <button type="button" onClick={onEdit} className="h-9 rounded-full border border-border px-3 text-xs font-semibold" aria-label={`Editar meta ${goal.name}`}>Editar</button>
        </div>
      )}
    </article>
  );
}
