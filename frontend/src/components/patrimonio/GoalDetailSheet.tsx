import { useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Pencil, PiggyBank, Sparkles } from "lucide-react";
import { goalHistory, goalPlan, goalProgress } from "@/lib/goalProgress";
import { formatDate, monthLabel, todayISO } from "@/lib/format";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { FinnosGoal } from "@/lib/goals";
import type { Account } from "@/types/finnos";

const STRATEGY: Record<string, string> = { acelerado: "Acelerada", equilibrado: "Equilibrada", seguro: "Segura" };

interface Props {
  goal: FinnosGoal | null;
  goals: FinnosGoal[];
  accounts: Account[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoney: (mode: "aporte" | "retirada") => void;
  onEdit: () => void;
  display: (n: number) => string;
}

/** A goal in full: the plan in plain words, how it is going, month by month, and every movement. */
export function GoalDetailSheet({ goal, goals, accounts, open, onOpenChange, onMoney, onEdit, display }: Props) {
  const [side] = useState<"bottom" | "right">(() => (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? "right" : "bottom"));
  if (!goal) return null;
  const today = todayISO();
  const account = accounts.find((a) => a.id === goal.account);
  const progress = goalProgress(goal, account ? account.balance : null, today);
  const plan = goalPlan(goal, progress.saved, today);
  const history = goalHistory(goal);
  const nameOf = (row: { account_id?: string | null; goal_id?: string | null }) =>
    row.goal_id ? `meta ${goals.find((g) => g.id === row.goal_id)?.name ?? "removida"}` : row.account_id ? accounts.find((a) => a.id === row.account_id)?.name ?? "conta removida" : null;
  // Saved at the end of each of the last 6 months, from the history.
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${today}T12:00:00`); d.setMonth(d.getMonth() - 5 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const atEnd = months.map((m) => ({ m, v: [...history].reverse().filter((r) => r.date.slice(0, 7) <= m).at(-1)?.balance ?? 0 }));
  // Scaled to the largest month, so the growth shows even when the target is far.
  const peak = Math.max(...atEnd.map((x) => x.v), 1);
  const askAi = () => window.dispatchEvent(new CustomEvent("finnos-ai-open", { detail: { question: `Como chego mais rápido na meta ${goal.name}?` } }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={cn("gap-0 overflow-y-auto p-0", side === "bottom" ? "max-h-[92svh] rounded-t-3xl" : "w-full sm:max-w-md")} data-testid="goal-detail">
        <div className="space-y-4 p-5 pb-8">
          <header className="pr-8">
            <p className="text-xs font-semibold text-primary">{goal.mode === "inteligente" ? "✦ Meta inteligente" : "Meta"} · {goal.category}</p>
            <SheetTitle className="mt-1 font-heading text-xl font-bold">{goal.name}</SheetTitle>
            <SheetDescription className="mt-1 text-sm">
              <span className="font-heading text-2xl font-bold tabular-nums text-foreground">{display(progress.saved)}</span> de {display(goal.target)} · {progress.percent.toFixed(0)}%
            </SheetDescription>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", progress.status === "concluida" ? "bg-income" : progress.status === "atrasada" ? "bg-amber-500" : "bg-primary")} style={{ width: `${progress.percent}%` }} /></div>
          </header>

          <section className="rounded-2xl bg-muted/60 p-3.5 text-sm leading-relaxed" data-testid="goal-detail-plan">
            <h3 className="text-xs font-medium text-muted-foreground">O plano</h3>
            {progress.status === "concluida" ? <p className="mt-1 font-semibold text-income">Meta concluída.</p> : (
              <>
                <p className="mt-1">
                  Faltam <strong className="tabular-nums">{display(plan.remaining)}</strong>
                  {plan.deadline ? <> para {monthLabel(plan.deadline).toLowerCase()}</> : null}
                  {plan.neededPerMonth ? <>: <strong className="tabular-nums">{display(plan.neededPerMonth)} por mês</strong> daqui em diante.</> : "."}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {goal.mode === "inteligente"
                    ? `A FINNOS sugeriu ${display(goal.contribution)} (${goal.frequency.toLowerCase()}) pela estratégia ${STRATEGY[goal.strategy ?? ""] ?? "escolhida"}, a partir da sua sobra média dos últimos meses.`
                    : `Seu plano é guardar ${display(goal.contribution)} (${goal.frequency.toLowerCase()}).`}
                  {plan.finishAtPlan ? ` Nesse ritmo, termina em ${monthLabel(plan.finishAtPlan).toLowerCase()}.` : ""}
                </p>
                {plan.pacePerMonth > 0 ? <p className="mt-1 text-muted-foreground">Na prática você guardou {display(plan.pacePerMonth)} por mês{plan.finishAtPace ? `, o que leva até ${monthLabel(plan.finishAtPace).toLowerCase()}` : ""}.</p> : null}
                {progress.status === "atrasada" ? <p className="mt-1 font-semibold text-amber-700 dark:text-amber-300">Está {display(progress.behindBy)} atrás do que o plano esperava até hoje.</p> : null}
                {progress.tracking ? <p className="mt-1 text-muted-foreground">O valor acompanha o saldo de {account?.name}.</p> : null}
              </>
            )}
          </section>

          <section data-testid="goal-detail-chart">
            <h3 className="text-xs font-medium text-muted-foreground">Guardado no fim de cada mês</h3>
            <div className="mt-2 flex h-24 items-end gap-2" aria-label="Valor guardado por mês">
              {atEnd.map(({ m, v }) => (
                <div key={m} className="flex flex-1 flex-col items-center gap-1" title={`${monthLabel(m)}: ${display(v)}`}>
                  <div className={cn("w-full rounded-t", m === today.slice(0, 7) ? "bg-primary" : "bg-primary/30")} style={{ height: `${Math.max(3, (v / peak) * 80)}px` }} />
                  <span className="text-[10px] text-muted-foreground">{monthLabel(m).slice(0, 3)}</span>
                </div>
              ))}
            </div>
          </section>

          <section data-testid="goal-detail-history">
            <h3 className="text-xs font-medium text-muted-foreground">Histórico ({history.length})</h3>
            {history.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nenhum movimento ainda. Use Guardar para registrar o primeiro.</p> : (
              <ul className="mt-1 divide-y divide-border/70">
                {history.map((row, i) => {
                  const out = row.kind === "retirada";
                  const where = nameOf(row);
                  const Icon = row.goal_id ? ArrowLeftRight : out ? ArrowUpRight : ArrowDownLeft;
                  return (
                    <li key={`${row.date}-${i}`} className="flex items-center gap-3 py-2.5" data-testid="goal-history-row">
                      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", out ? "bg-expense/10 text-expense" : "bg-income/10 text-income")}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {row.initial ? "Valor inicial" : out ? (row.goal_id ? `Movido para ${where}` : where ? `Retirado para ${where}` : "Retirado") : row.goal_id ? `Veio da ${where}` : where ? `Guardado de ${where}` : "Guardado"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{row.date ? formatDate(row.date) : "—"}{row.note && !row.initial ? ` · ${row.note}` : ""} · saldo {display(row.balance)}</span>
                      </span>
                      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", out ? "text-expense" : "text-income")}>{out ? "−" : "+"}{display(row.value)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="grid grid-cols-2 gap-2">
            {!progress.tracking && progress.status !== "concluida" ? (
              <button type="button" onClick={() => onMoney("aporte")} className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground" data-testid="goal-detail-deposit"><PiggyBank className="h-4 w-4" aria-hidden="true" />Guardar</button>
            ) : null}
            {!progress.tracking && progress.saved > 0 ? (
              <button type="button" onClick={() => onMoney("retirada")} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold" data-testid="goal-detail-withdraw"><ArrowLeftRight className="h-4 w-4" aria-hidden="true" />Retirar ou mover</button>
            ) : null}
            <button type="button" onClick={onEdit} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold"><Pencil className="h-4 w-4" aria-hidden="true" />Editar</button>
            <button type="button" onClick={askAi} className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-muted text-sm font-semibold"><Sparkles className="h-4 w-4" aria-hidden="true" />Perguntar à IA</button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
