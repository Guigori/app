/** How a goal is going: saved so far (manual contributions or a tracked account balance)
 *  against what the plan expected by today. */
import type { FinnosGoal } from "@/lib/goals";

const monthlyEquivalent = (goal: Pick<FinnosGoal, "contribution" | "frequency">) =>
  goal.contribution * (goal.frequency === "Semanal" ? 52 : goal.frequency === "Quinzenal" ? 26 : 12) / 12;

export interface GoalProgress {
  saved: number;
  percent: number;
  /** What the plan expected by today (initial reserve + elapsed months × monthly contribution). */
  expected: number;
  status: "concluida" | "no-ritmo" | "atrasada";
  behindBy: number;
  lastDeposit: { date: string; value: number } | null;
  tracking: boolean;
}

export function goalProgress(goal: FinnosGoal, accountBalance: number | null, today: string): GoalProgress {
  const tracking = Boolean(goal.track_account) && accountBalance !== null;
  const saved = Math.max(0, Math.min(goal.target, tracking ? (accountBalance as number) : goal.saved));
  const deposits = goal.deposits ?? [];
  const depositedTotal = deposits.reduce((s, d) => s + d.value, 0);
  const initial = Math.max(0, goal.saved - depositedTotal);
  const created = goal.createdAt ? new Date(goal.createdAt) : new Date(`${today}T12:00:00`);
  const now = new Date(`${today}T12:00:00`);
  const monthsElapsed = Math.max(0, (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth()) + (now.getDate() >= created.getDate() ? 0 : -1));
  const expected = Math.min(goal.target, Math.round((initial + monthsElapsed * monthlyEquivalent(goal)) * 100) / 100);
  const behindBy = Math.max(0, Math.round((expected - saved) * 100) / 100);
  const last = [...deposits].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  return {
    saved,
    percent: goal.target > 0 ? Math.min(100, (saved / goal.target) * 100) : 0,
    expected,
    status: saved >= goal.target ? "concluida" : behindBy > 0.009 ? "atrasada" : "no-ritmo",
    behindBy,
    lastDeposit: last,
    tracking,
  };
}

/** Adds a contribution, never past the target. */
export function addDeposit(goal: FinnosGoal, value: number, date: string): FinnosGoal {
  const room = Math.max(0, goal.target - goal.saved);
  const amount = Math.round(Math.min(value, room) * 100) / 100;
  return { ...goal, saved: Math.round((goal.saved + amount) * 100) / 100, deposits: [...(goal.deposits ?? []), { date, value: amount }] };
}
