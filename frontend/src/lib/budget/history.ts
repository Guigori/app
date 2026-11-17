/**
 * Orçamento · tela 7 (Histórico): os meses com movimento, cada um fechado, aberto ou desatualizado (algo mudou
 * depois do fechamento), com quanto foi guardado em metas e se ficou dentro dos limites.
 */
import type { MonthTrend } from "@/types/finnos";
import type { BudgetClosing, BudgetPlan } from "@/lib/budget/server";

export type HistoryState = "fechado" | "aberto" | "desatualizado";
export interface HistoryMonth {
  month: string; income: number; expense: number; result: number;
  state: HistoryState;
  /** Kept in metas at the closing (allocation to metas) or, if not closed, what the plan set aside. */
  saved: number; savedPlanned: number;
  /** Closed months only: every category within its limit. */
  withinLimits: boolean | null;
  over: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function buildHistory(trends: MonthTrend[], closingOf: (m: string) => BudgetClosing | null, planOf: (m: string) => BudgetPlan): HistoryMonth[] {
  // Months before the first one with any movement are not history yet.
  const first = trends.findIndex((t) => t.income > 0 || t.expense > 0);
  return (first < 0 ? [] : trends.slice(first)).map((t) => {
    const c = closingOf(t.month), p = planOf(t.month);
    const stale = !!c && (Math.abs(c.earned - t.income) >= 0.01 || Math.abs(c.spent - t.expense) >= 0.01);
    const over = c ? c.categories.filter((x) => x.limit > 0 && x.spent > x.limit).map((x) => x.name) : [];
    return {
      month: t.month,
      income: c?.earned ?? t.income, expense: c?.spent ?? t.expense, result: c?.result ?? r2(t.income - t.expense),
      state: !c ? "aberto" : stale ? "desatualizado" : "fechado",
      saved: r2((c?.allocation ?? []).filter((a) => a.kind === "meta").reduce((s, a) => s + a.value, 0)),
      savedPlanned: r2(p.planned_saving ?? 0),
      withinLimits: c ? over.length === 0 : null,
      over,
    };
  });
}

/** Previsto que aconteceu: for each closed month, how much of what was expected happened by the closing. */
export function forecastHits(months: string[], closingOf: (m: string) => BudgetClosing | null) {
  const rows = months.map((m) => {
    const est = closingOf(m)?.estimates ?? [];
    const hit = est.filter((e) => e.outcome === "aconteceu").length, miss = est.length - hit;
    return { month: m, hit, miss, total: est.length, pct: est.length ? hit / est.length : null };
  }).filter((r) => r.total > 0);
  // The forecast that misses most: expected in 2+ closed months and open the most times.
  const seen = new Map<string, { name: string; times: number; missed: number }>();
  for (const m of months) for (const e of closingOf(m)?.estimates ?? []) {
    const k = e.name.trim().toLowerCase();
    const cur = seen.get(k) ?? { name: e.name, times: 0, missed: 0 };
    cur.times += 1; if (e.outcome === "aberto") cur.missed += 1;
    seen.set(k, cur);
  }
  const worst = [...seen.values()].filter((x) => x.times >= 2 && x.missed > 0).sort((a, b) => b.missed / b.times - a.missed / a.times || b.times - a.times)[0] ?? null;
  return { rows, worst };
}

/** Guardado por mês: contributions to metas registered in Metas in each month, against what the plan set aside. */
export function savedByMonth(months: string[], goals: { deposits?: { date: string; value: number; kind?: "aporte" | "retirada" }[] }[], planOf: (m: string) => BudgetPlan) {
  return months.map((m) => {
    const saved = goals.reduce((s, g) => s + (g.deposits ?? []).filter((d) => d.date.slice(0, 7) === m && (d.kind ?? "aporte") === "aporte").reduce((a, d) => a + d.value, 0), 0);
    return { month: m, saved: r2(saved), planned: r2(planOf(m).planned_saving ?? 0) };
  });
}
