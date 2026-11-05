import { ChevronRight, PiggyBank } from "lucide-react";
import { type FinnosGoal } from "@/lib/goals";
import { goalPlan, goalProgress } from "@/lib/goalProgress";
import { monthLabel, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Account } from "@/types/finnos";

/** One goal at a glance; tapping it opens the detail with the plan and the whole history. */
export function GoalCard({ goal, accounts, display, onOpen, onDeposit }: {
  goal: FinnosGoal;
  accounts: Account[];
  display: (n: number) => string;
  onOpen: () => void;
  onDeposit: () => void;
}) {
  const account = accounts.find((a) => a.id === goal.account);
  const today = todayISO();
  const progress = goalProgress(goal, account ? account.balance : null, today);
  const plan = goalPlan(goal, progress.saved, today);
  const done = progress.status === "concluida";

  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card transition-colors hover:border-primary/30" data-testid={`goal-${goal.id}`}>
      <button type="button" onClick={onOpen} className="block w-full p-4 text-left" aria-label={`Ver detalhes da meta ${goal.name}`} data-testid="goal-open">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate font-heading text-base font-bold">{goal.name}</span>
            <span className="block text-xs text-muted-foreground">{goal.mode === "inteligente" ? "✦ Meta inteligente" : "Meta"} · {goal.category}</span>
          </span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", done ? "bg-income/10 text-income" : progress.status === "no-ritmo" ? "bg-primary/10 text-primary" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
            {done ? "Concluída" : progress.status === "no-ritmo" ? "No ritmo" : "Atrasada"}
          </span>
        </span>
        <span className="mt-3 flex items-baseline justify-between gap-2">
          <span className="font-heading text-xl font-bold tabular-nums">{display(progress.saved)}</span>
          <span className="text-sm tabular-nums text-muted-foreground">de {display(goal.target)} · {progress.percent.toFixed(0)}%</span>
        </span>
        <span className="mt-2 block h-2 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full transition-[width]", done ? "bg-income" : progress.status === "atrasada" ? "bg-amber-500" : "bg-primary")} style={{ width: `${progress.percent}%` }} /></span>
        <span className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {done ? "Você chegou lá."
              : progress.tracking ? `Acompanhando o saldo de ${account?.name}`
              : plan.neededPerMonth ? `Faltam ${display(plan.remaining)} · ${display(plan.neededPerMonth)}/mês${plan.deadline ? ` até ${monthLabel(plan.deadline).toLowerCase()}` : ""}`
              : `Faltam ${display(plan.remaining)}`}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </span>
      </button>
      {!progress.tracking && !done ? (
        <div className="px-4 pb-4">
          <button type="button" onClick={onDeposit} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground" data-testid="goal-deposit-button"><PiggyBank className="h-4 w-4" aria-hidden="true" />Guardar</button>
        </div>
      ) : null}
    </article>
  );
}
