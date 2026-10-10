/** Device-local goal drafts until the authenticated goals API is available.
 * Never claim these records are synced to the user's cloud account. */
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
export function listGoals(userId: string): FinnosGoal[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(userId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is FinnosGoal => !!x && typeof x === "object" && typeof x.id === "string" && typeof x.name === "string") : [];
  } catch { return []; }
}
export function saveGoal(userId: string, goal: FinnosGoal): void {
  const next = [goal, ...listGoals(userId)];
  localStorage.setItem(key(userId), JSON.stringify(next));
}
