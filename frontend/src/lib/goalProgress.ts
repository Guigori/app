/** How a goal is going: saved so far (manual contributions or a tracked account balance)
 *  against what the plan expected by today. */
import type { FinnosGoal, GoalMovement } from "@/lib/goals";

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
  const depositedTotal = deposits.reduce((s, d) => s + (d.kind === "retirada" ? -d.value : d.value), 0);
  const initial = Math.max(0, goal.saved - depositedTotal);
  const created = goal.createdAt ? new Date(goal.createdAt) : new Date(`${today}T12:00:00`);
  const now = new Date(`${today}T12:00:00`);
  const monthsElapsed = Math.max(0, (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth()) + (now.getDate() >= created.getDate() ? 0 : -1));
  const expected = Math.min(goal.target, Math.round((initial + monthsElapsed * monthlyEquivalent(goal)) * 100) / 100);
  const behindBy = Math.max(0, Math.round((expected - saved) * 100) / 100);
  const last = [...deposits].filter((d) => d.kind !== "retirada").sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
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

const round = (v: number) => Math.round(v * 100) / 100;
const signed = (m: GoalMovement) => (m.kind === "retirada" ? -m.value : m.value);

/** Takes money out of a goal (to an account or another goal), never more than it has. */
export function withdraw(goal: FinnosGoal, value: number, date: string, to: { accountId?: string | null; goalId?: string | null; note?: string | null } = {}): FinnosGoal {
  const amount = round(Math.min(value, Math.max(0, goal.saved)));
  return {
    ...goal,
    saved: round(goal.saved - amount),
    deposits: [...(goal.deposits ?? []), { date, value: amount, kind: "retirada", account_id: to.accountId ?? null, goal_id: to.goalId ?? null, note: to.note ?? null }],
  };
}

/** Records where a contribution came from. */
export function contribute(goal: FinnosGoal, value: number, date: string, from: { accountId?: string | null; goalId?: string | null; note?: string | null } = {}): FinnosGoal {
  const next = addDeposit(goal, value, date);
  const last = next.deposits!.length - 1;
  next.deposits = next.deposits!.map((m, i) => (i === last ? { ...m, kind: "aporte" as const, account_id: from.accountId ?? null, goal_id: from.goalId ?? null, note: from.note ?? null } : m));
  return next;
}

/** Moves money from one goal to another: limited by what the first has and the room in the second. */
export function moveBetweenGoals(from: FinnosGoal, to: FinnosGoal, value: number, date: string): [FinnosGoal, FinnosGoal, number] {
  const amount = round(Math.min(value, Math.max(0, from.saved), Math.max(0, to.target - to.saved)));
  return [withdraw(from, amount, date, { goalId: to.id }), contribute(to, amount, date, { goalId: from.id }), amount];
}

export interface GoalHistoryRow extends GoalMovement {
  /** What the goal had right after this movement. */
  balance: number;
  initial?: boolean;
}

/** Every movement, newest first, with the balance after each one; what the goal started with comes last. */
export function goalHistory(goal: FinnosGoal): GoalHistoryRow[] {
  const moves = [...(goal.deposits ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const net = moves.reduce((s, m) => s + signed(m), 0);
  const initial = round(goal.saved - net);
  let balance = initial;
  const rows: GoalHistoryRow[] = moves.map((m) => { balance = round(balance + signed(m)); return { ...m, kind: m.kind ?? "aporte", balance }; });
  if (initial > 0.009) rows.unshift({ date: (goal.createdAt ?? "").slice(0, 10), value: initial, kind: "aporte", balance: initial, initial: true, note: "Valor inicial" });
  return rows.reverse();
}

export interface GoalPlan {
  remaining: number;
  /** The month the plan expects to end (creation + planned months). */
  deadline: string | null;
  /** Monthly amount still needed to finish by the deadline. */
  neededPerMonth: number | null;
  /** Average actually saved per month in the last 3 months with movement. */
  pacePerMonth: number;
  /** Month the goal finishes at the planned contribution, and at the real pace. */
  finishAtPlan: string | null;
  finishAtPace: string | null;
}

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** What is left, by when, how much a month it takes, and when it ends at the plan and at the real pace. */
export function goalPlan(goal: FinnosGoal, saved: number, today: string): GoalPlan {
  const remaining = round(Math.max(0, goal.target - saved));
  const month = today.slice(0, 7);
  const deadline = goal.createdAt ? addMonths(goal.createdAt.slice(0, 7), goal.months) : null;
  const monthsLeft = deadline ? Math.max(1, (Number(deadline.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + Number(deadline.slice(5, 7)) - Number(month.slice(5, 7))) : null;
  const byMonth = new Map<string, number>();
  for (const m of goal.deposits ?? []) byMonth.set(m.date.slice(0, 7), (byMonth.get(m.date.slice(0, 7)) ?? 0) + signed(m));
  const recent = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3);
  const pacePerMonth = recent.length ? round(Math.max(0, recent.reduce((s, [, v]) => s + v, 0) / recent.length)) : 0;
  const plan = monthlyEquivalent(goal);
  return {
    remaining,
    deadline,
    neededPerMonth: monthsLeft && remaining > 0 ? round(remaining / monthsLeft) : null,
    pacePerMonth,
    finishAtPlan: remaining <= 0 ? month : plan > 0 ? addMonths(month, Math.ceil(remaining / plan)) : null,
    finishAtPace: remaining <= 0 ? month : pacePerMonth > 0 ? addMonths(month, Math.ceil(remaining / pacePerMonth)) : null,
  };
}
