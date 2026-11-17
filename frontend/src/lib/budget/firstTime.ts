/**
 * Orçamento · tela 13 (primeira vez): um ponto de partida com o que já está no Fluxo dos últimos 3 meses.
 * Nada é criado sozinho: a pessoa liga ou desliga cada limite sugerido e só então cria o orçamento.
 */
import type { BudgetSummary, MonthTrend, UpcomingItem } from "@/types/finnos";

export interface StartSuggestion { category_id: string; name: string; value: number; min: number; max: number; months: number; fixed: number }

export interface StartView {
  months: number;
  income: number;
  fixed: { total: number; names: string[] };
  subscriptions: number;
  goals: number;
  suggestions: StartSuggestion[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Rounded up to the next R$ 10: a limit is a round number. */
export const roundLimit = (v: number) => Math.ceil(v / 10) * 10;

export function buildStart({ past, trends, upcoming, subscriptions, goalsMonthly }: {
  past: BudgetSummary[]; trends: MonthTrend[]; upcoming: UpcomingItem[]; subscriptions: number; goalsMonthly: number;
}): StartView {
  const withMoves = trends.filter((m) => m.income > 0 || m.expense > 0);
  const income = withMoves.length ? r2(withMoves.reduce((s, m) => s + m.income, 0) / withMoves.length) : 0;
  const fixedItems = upcoming.filter((u) => u.type === "despesa" && u.kind === "fixa");
  const fixedByCat = new Map<string, number>();
  for (const u of fixedItems) if (u.category_id) fixedByCat.set(u.category_id, (fixedByCat.get(u.category_id) ?? 0) + u.value);

  const by = new Map<string, { name: string; values: number[] }>();
  for (const b of past) for (const r of b.rows) {
    if (r.group === "metas") continue;
    const cur = by.get(r.category_id) ?? { name: r.name, values: [] };
    cur.values.push(r.spent);
    by.set(r.category_id, cur);
  }
  const suggestions: StartSuggestion[] = [...by.entries()]
    .map(([category_id, x]) => {
      // Average of the months the category was used: a month with no record (not yet registered) does not halve it.
      const used = x.values.filter((v) => v > 0);
      const avg = used.length ? used.reduce((s, v) => s + v, 0) / used.length : 0;
      return { category_id, name: x.name, value: roundLimit(avg), min: r2(used.length ? Math.min(...used) : 0), max: r2(used.length ? Math.max(...used) : 0), months: used.length, fixed: r2(fixedByCat.get(category_id) ?? 0) };
    })
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  return {
    months: past.length,
    income,
    fixed: { total: r2(fixedItems.reduce((s, u) => s + u.value, 0)), names: fixedItems.map((u) => u.name) },
    subscriptions: r2(subscriptions),
    goals: r2(goalsMonthly),
    suggestions,
  };
}

export function suggestionNote(s: StartSuggestion, brl: (v: number) => string): string {
  const range = s.max - s.min >= Math.max(20, s.value * 0.15) ? `variou de ${brl(s.min)} a ${brl(s.max)}` : "estável";
  return `Média de ${s.months} ${s.months === 1 ? "mês" : "meses"} · ${range}${s.fixed > 0 ? ` · inclui contas fixas de ${brl(s.fixed)}` : ""}`;
}
