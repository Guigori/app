/**
 * Orçamento por mês no servidor, como os outros módulos: o plano revisado pela pessoa e o retrato do fechamento.
 * Leitura: o servidor (ou a última resposta guardada, ou a cópia do aparelho quando não há conexão).
 * Gravação: direto no servidor; sem conexão, fica na fila do aparelho e vai assim que voltar (mesma fila do Fluxo).
 * No modo local (sem conta) fica só neste aparelho.
 */
import { ApiError, apiGet, apiPut, apiDelete } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import { canSync } from "@/lib/quota";
import { cachedFetch } from "@/lib/offline/accountCache";
import { listSyncOperations, queueBudgetMonth, type BudgetMonthKind, type BudgetMonthPayload } from "@/lib/sync/queue";

export interface BudgetPlan {
  month: string;
  approved: string[];
  ignored: string[];
  saving: Record<string, number>;
  planned_income: number;
  planned_bills: number;
  planned_saving: number;
  planned_spend: number;
  /** Special plans included in this month by the person (none enters on its own). */
  specials?: string[];
  /** Things to remember in the month, shown in the Orçamento on the day (none is created on its own). */
  reminders?: PlanReminder[];
  /** Value of each included record when the month was planned ("tx:<id>" → value): compared at the closing. */
  expected?: Record<string, number>;
  updated_at?: string | null;
}

export interface PlanReminder { id: string; date: string; text: string; kind: "conta" | "assinatura" | "recebimento" | "meta" | "outro"; done?: boolean }

export interface BudgetClosing {
  month: string;
  closed_at: string;
  earned: number;
  spent: number;
  result: number;
  daily_planned: number;
  daily_spent: number;
  planned_income?: number | null;
  planned_bills?: number | null;
  allocation: { id: string; kind: "meta" | "conta" | "investimento"; name: string; value: number; target_id?: string | null; done?: boolean }[];
  categories: { category_id: string; name: string; spent: number; limit: number }[];
  /** The person's note about the month. */
  note?: string | null;
  /** What was expected in the month and whether it happened by the closing. */
  estimates?: { name: string; type: "receita" | "despesa"; value: number; outcome: "aconteceu" | "aberto" }[];
}

export const emptyPlan = (month: string): BudgetPlan => ({ month, approved: [], ignored: [], saving: {}, planned_income: 0, planned_bills: 0, planned_saving: 0, planned_spend: 0, specials: [] });

const LOCAL = { plans: "finnos:budget:plans", closings: "finnos:budget:closings", specials: "finnos:budget:specials" } as const;
function localRead<T>(key: string): Record<string, T> {
  try { const v = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, T>; return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function localWrite<T>(key: string, value: Record<string, T>) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

async function deviceRows<T>(name: string): Promise<T[]> {
  const { mirrorRows } = await import("@/lib/mirror");
  return mirrorRows<T & { user_id?: string; id?: string; version?: number }>(name).map(({ user_id: _u, id, version: _v, ...row }) => ({ month: id, ...row }) as unknown as T);
}

/** What is still waiting in the device queue wins over what the server last said (it is newer). */
async function withPending<T extends { month: string }>(rows: T[], put: BudgetMonthKind, del?: BudgetMonthKind): Promise<T[]> {
  const ops = (await listSyncOperations().catch(() => [])).filter((o) => o.kind === put || o.kind === del);
  const by = new Map(rows.map((r) => [r.month, r]));
  for (const op of ops) {
    if (!op.entityId) continue;
    if (op.kind === del) by.delete(op.entityId);
    else by.set(op.entityId, { ...(op.payload as unknown as T), month: op.entityId });
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export async function fetchBudgetPlans(): Promise<BudgetPlan[]> {
  if (isLocalMode()) return Object.values(localRead<BudgetPlan>(LOCAL.plans));
  const rows = await cachedFetch("budget-plans", () => apiGet<BudgetPlan[]>("/budgets/plans"), () => deviceRows<BudgetPlan>("budget_plans")).catch(() => [] as BudgetPlan[]);
  return withPending(rows, "budgetPlan.put");
}

export async function fetchBudgetClosings(): Promise<BudgetClosing[]> {
  if (isLocalMode()) return Object.values(localRead<BudgetClosing>(LOCAL.closings));
  const rows = await cachedFetch("budget-closings", () => apiGet<BudgetClosing[]>("/budgets/closings"), () => deviceRows<BudgetClosing>("budget_closings")).catch(() => [] as BudgetClosing[]);
  return withPending(rows, "budgetClosing.put", "budgetClosing.delete");
}

/** Network down (or the server unreachable): keep it in the queue instead of losing it. */
function offline(error: unknown): boolean {
  return !canSync() || !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}

async function write(kind: BudgetMonthKind, month: string, path: string, payload: BudgetMonthPayload | null): Promise<"saved" | "queued"> {
  if (!canSync()) { await queueBudgetMonth(kind, month, payload ?? {}); return "queued"; }
  try {
    if (payload) await apiPut(path, payload); else await apiDelete<void>(path);
    return "saved";
  } catch (error) {
    if (!offline(error)) throw error;
    await queueBudgetMonth(kind, month, payload ?? {});
    return "queued";
  }
}

export async function saveBudgetPlan(plan: BudgetPlan): Promise<"saved" | "queued"> {
  const { month, updated_at: _u, ...payload } = plan;
  if (isLocalMode()) { localWrite(LOCAL.plans, { ...localRead<BudgetPlan>(LOCAL.plans), [month]: plan }); return "saved"; }
  return write("budgetPlan.put", month, `/budgets/plans/${month}`, payload as unknown as BudgetMonthPayload);
}

export async function saveBudgetClosing(closing: BudgetClosing): Promise<"saved" | "queued"> {
  const { month, ...payload } = closing;
  if (isLocalMode()) { localWrite(LOCAL.closings, { ...localRead<BudgetClosing>(LOCAL.closings), [month]: closing }); return "saved"; }
  return write("budgetClosing.put", month, `/budgets/closings/${month}`, payload as unknown as BudgetMonthPayload);
}

export async function reopenBudgetClosing(month: string): Promise<"saved" | "queued"> {
  if (isLocalMode()) { const all = localRead<BudgetClosing>(LOCAL.closings); delete all[month]; localWrite(LOCAL.closings, all); return "saved"; }
  return write("budgetClosing.delete", month, `/budgets/closings/${month}`, null);
}

// --- Planos especiais: viagem, Natal, mudança… Só datas, valor e limites; o dinheiro fica numa meta (ou é o 13º).

export const SPECIAL_KINDS = ["Viagem", "Férias", "Natal", "Mudança", "Evento", "Compra", "Renda menor", "Imprevisto"] as const;
export type SpecialKind = (typeof SPECIAL_KINDS)[number];

export interface BudgetSpecial {
  id: string;
  name: string;
  kind: SpecialKind;
  start: string;
  end: string;
  amount: number;
  /** nova: a meta criada para o plano · existente: uma meta que já existia · 13: o 13º salário de dezembro. */
  source: "nova" | "existente" | "13";
  goal_id?: string | null;
  goal_name?: string | null;
  monthly: number;
  categories: { category_id: string; name: string; limit: number }[];
  created_at?: string | null;
}

async function deviceSpecials(): Promise<BudgetSpecial[]> {
  const { mirrorRows } = await import("@/lib/mirror");
  return mirrorRows<BudgetSpecial & { user_id?: string; version?: number }>("budget_specials").map(({ user_id: _u, version: _v, ...row }) => row);
}

export async function fetchBudgetSpecials(): Promise<BudgetSpecial[]> {
  if (isLocalMode()) return Object.values(localRead<BudgetSpecial>(LOCAL.specials));
  const rows = await cachedFetch("budget-specials", () => apiGet<BudgetSpecial[]>("/budgets/specials"), deviceSpecials).catch(() => [] as BudgetSpecial[]);
  const ops = (await listSyncOperations().catch(() => [])).filter((o) => o.kind === "budgetSpecial.put" || o.kind === "budgetSpecial.delete");
  const by = new Map(rows.map((r) => [r.id, r]));
  for (const op of ops) {
    if (!op.entityId) continue;
    if (op.kind === "budgetSpecial.delete") by.delete(op.entityId);
    else by.set(op.entityId, { ...(op.payload as unknown as BudgetSpecial), id: op.entityId });
  }
  return [...by.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export async function saveBudgetSpecial(special: BudgetSpecial): Promise<"saved" | "queued"> {
  const { id, ...payload } = special;
  if (isLocalMode()) { localWrite(LOCAL.specials, { ...localRead<BudgetSpecial>(LOCAL.specials), [id]: special }); return "saved"; }
  return write("budgetSpecial.put", id, `/budgets/specials/${id}`, payload as unknown as BudgetMonthPayload);
}

/** Ending a plan removes only the plan: the meta and its money stay in Metas. */
export async function endBudgetSpecial(id: string): Promise<"saved" | "queued"> {
  if (isLocalMode()) { const all = localRead<BudgetSpecial>(LOCAL.specials); delete all[id]; localWrite(LOCAL.specials, all); return "saved"; }
  return write("budgetSpecial.delete", id, `/budgets/specials/${id}`, null);
}

export const newSpecialId = () => `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
