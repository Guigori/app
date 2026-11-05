import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import { cachedFetch } from "@/lib/offline/accountCache";
import { fetchDashboard } from "@/lib/data";
import { addMonth, currentMonth } from "@/lib/format";
export type FinnosGoal = {
  id: string;
  name: string;
  category: string;
  mode: "tradicional" | "inteligente";
  target: number;
  saved: number;
  months: number;
  contribution: number;
  frequency: string;
  account: string;
  strategy: string | null;
  remind: boolean;
  radar: boolean;
  createdAt: string;
  /** Contributions recorded with "Guardar" (date + value). */
  deposits?: { date: string; value: number }[];
  /** Progress follows the linked account's balance instead of the manual amount. */
  track_account?: boolean;
};
const key = (userId: string) => `finnos:goals:v1:${userId}`;
function localGoals(userId: string): FinnosGoal[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(userId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is FinnosGoal => !!x && typeof x === "object" && typeof x.id === "string" && typeof x.name === "string") : [];
  } catch { return []; }
}
export async function saveGoal(userId: string, goal: FinnosGoal): Promise<void> {
  if (!isLocalMode()) {
    const { id, createdAt, ...input } = goal;
    void id; void createdAt;
    await apiPost<FinnosGoal>("/goals", input);
    return;
  }
  const next = [goal, ...localGoals(userId)];
  localStorage.setItem(key(userId), JSON.stringify(next));
}

export async function listGoals(userId: string): Promise<FinnosGoal[]> {
  return isLocalMode() ? localGoals(userId) : cachedFetch("goals", () => apiGet<FinnosGoal[]>("/goals"));
}
export type GoalSuggestion = { income:number; expense:number; reserved:number; capacity:number; months_observed:number; strategies:{id:string;label:string;amount:number}[] };
const monthlyEquivalent = (goal: FinnosGoal) => goal.contribution * (goal.frequency === "Semanal" ? 52 : goal.frequency === "Quinzenal" ? 26 : 12) / 12;
const strategiesFor = (capacity: number) => [
  { id: "acelerado", label: "Acelerado", amount: capacity },
  { id: "equilibrado", label: "Equilibrado", amount: Math.floor(capacity * 75) / 100 },
  { id: "seguro", label: "Seguro", amount: Math.floor(capacity * 50) / 100 },
];
/** Same method as the server (/goals/suggestion): average realised income minus expenses of the
 *  last 3 months with movement, minus the contributions already planned for open goals. */
export async function fetchGoalSuggestion(userId?: string): Promise<GoalSuggestion> {
  if (!isLocalMode()) return apiGet<GoalSuggestion>("/goals/suggestion");
  const months = [0, -1, -2].map((offset) => addMonth(currentMonth(), offset));
  const summaries = await Promise.all(months.map((month) => fetchDashboard(month)));
  const observed = summaries.filter((d) => d.income > 0 || d.expense > 0);
  const n = Math.max(observed.length, 1);
  const income = Math.round(observed.reduce((s, d) => s + d.income, 0) / n * 100) / 100;
  const expense = Math.round(observed.reduce((s, d) => s + d.expense, 0) / n * 100) / 100;
  const reserved = Math.round((userId ? localGoals(userId) : []).filter((g) => g.saved < g.target).reduce((s, g) => s + monthlyEquivalent(g), 0) * 100) / 100;
  const capacity = Math.max(Math.round((income - expense - reserved) * 100) / 100, 0);
  return { income, expense, reserved, capacity, months_observed: observed.length, strategies: strategiesFor(capacity) };
}

/** Editing a plan changes only the goal document, never its linked bank balance. */
export async function updateGoal(userId: string, goal: FinnosGoal): Promise<void> {
  if (!isLocalMode()) {
    const { id, createdAt, ...input } = goal;
    void createdAt;
    await apiPut<FinnosGoal>(`/goals/${encodeURIComponent(id)}`, input);
    return;
  }
  const current = localGoals(userId);
  if (!current.some(item => item.id === goal.id)) throw new Error("Meta não encontrada.");
  localStorage.setItem(key(userId), JSON.stringify(current.map(item => item.id === goal.id ? goal : item)));
}

/** Deletion is explicit. Local-mode goals stay isolated by the local user's ID. */
export async function deleteGoal(userId: string, goalId: string): Promise<void> {
  if (!isLocalMode()) {
    await apiDelete<void>(`/goals/${encodeURIComponent(goalId)}`);
    return;
  }
  localStorage.setItem(key(userId), JSON.stringify(localGoals(userId).filter(item => item.id !== goalId)));
}
