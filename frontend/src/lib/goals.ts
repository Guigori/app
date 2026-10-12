import { apiGet, apiPost } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import { cachedFetch } from "@/lib/offline/accountCache";
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
export function fetchGoalSuggestion(): Promise<GoalSuggestion> {
  return apiGet<GoalSuggestion>("/goals/suggestion");
}
