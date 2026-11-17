/**
 * Orçamento · tela 11 (Criar novo período): ponto de partida dos limites e as datas do ciclo.
 * Criar o período guarda só o que é do Orçamento: o ciclo (datas e limites) e o plano do mês (o que foi incluído e
 * quanto vai para metas). Contas e receitas continuam no Fluxo; nada é lançado na Carteira.
 */
import type { Category } from "@/types/finnos";

export type PeriodBase = "anterior" | "503020" | "proprio" | "modelo" | "novo";
export type PeriodCycle = "1" | "5" | "c";

const r2 = (v: number) => Math.round(v * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); };

export function cycleDates(month: string, cycle: PeriodCycle, custom?: { start: string; end: string }): { start: string; end: string } {
  if (cycle === "c" && custom) return custom;
  if (cycle === "5") {
    const [y, m] = month.split("-").map(Number);
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return { start: `${month}-05`, end: `${ny}-${pad(nm)}-04` };
  }
  return { start: `${month}-01`, end: `${month}-${pad(lastDay(month))}` };
}

/**
 * Limits for the new period, per spending category:
 * - anterior: the same limits as now;
 * - proprio: the same, with the percentages the person saved in Configurar (e.g. 55/25/20);
 * - 503020: up to 50% of the planned income for necessidades and 30% for desejos (the 20% for the future is Metas'
 *   job), shared in each group in proportion to today's limits (equally when a group has none);
 * - modelo: a model saved in Configurar;
 * - novo: no limits, the person sets them later.
 */
export function limitsForBase(base: PeriodBase, input: { categories: Pick<Category, "id" | "group">[]; current: Record<string, number>; income: number; model?: Record<string, number> | null; split?: { necessidades: number; desejos: number } | null }): Record<string, number> {
  const cats = input.categories.filter((c) => c.group !== "metas");
  if (base === "novo") return {};
  if (base === "modelo") return Object.fromEntries(cats.filter((c) => (input.model?.[c.id] ?? 0) > 0).map((c) => [c.id, r2(input.model![c.id])]));
  if (base === "anterior") return Object.fromEntries(cats.filter((c) => (input.current[c.id] ?? 0) > 0).map((c) => [c.id, r2(input.current[c.id])]));
  const out: Record<string, number> = {};
  // 50/30/20 or the person's own split (proprio): the share for the future is Metas' job, not a limit.
  const shares = base === "proprio" && input.split ? [["necessidades", input.split.necessidades / 100], ["desejos", input.split.desejos / 100]] as const : [["necessidades", 0.5], ["desejos", 0.3]] as const;
  for (const [group, share] of shares) {
    const inGroup = cats.filter((c) => c.group === group);
    if (!inGroup.length || input.income <= 0) continue;
    const pot = input.income * share;
    const weight = inGroup.reduce((s, c) => s + (input.current[c.id] ?? 0), 0);
    const users = weight > 0 ? inGroup.filter((c) => (input.current[c.id] ?? 0) > 0) : inGroup;
    for (const c of users) out[c.id] = Math.floor((weight > 0 ? pot * (input.current[c.id] ?? 0) / weight : pot / users.length));
  }
  return out;
}

/** What changes from the current limits: kept as is, raised, lowered, added or removed. */
export function limitChanges(current: Record<string, number>, next: Record<string, number>, names: Record<string, string>) {
  const ids = new Set([...Object.keys(current), ...Object.keys(next)]);
  const kept: string[] = [], changed: { name: string; from: number; to: number }[] = [];
  for (const id of ids) {
    const a = r2(current[id] ?? 0), b = r2(next[id] ?? 0);
    if (!a && !b) continue;
    if (Math.abs(a - b) < 0.01) kept.push(names[id] ?? id);
    else changed.push({ name: names[id] ?? id, from: a, to: b });
  }
  changed.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from));
  return { kept, changed };
}
