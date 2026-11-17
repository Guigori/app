/**
 * Orçamento · tela 4 (Projeção). The months ahead with what the person registered in Fluxo: each month is the usual
 * result (average of the last complete months) plus what is out of the ordinary that month (pending, scheduled,
 * installments). What the app only repeats or projects never enters (the person approves it when planning the month).
 */
import type { Flow, MonthTrend } from "@/types/finnos";
import { isSuggestion, stateOf, upcomingKey } from "@/lib/budget/monthView";

export interface ProjectionItem { key: string; name: string; date: string; value: number; type: "receita" | "despesa"; state: "agendado" | "estimativa"; transaction_id: string | null }
export interface ProjectionMonth { month: string; items: ProjectionItem[]; base: number; total: number }
export interface ProjectionView {
  base: number;
  monthsObserved: number;
  months: ProjectionMonth[];
  negative: ProjectionMonth[];
  worst: ProjectionMonth | null;
  sum: number;
  /** Large one-off bills in the period that a meta could spread over the months. */
  yearly: { total: number; perMonth: number; items: ProjectionItem[] } | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The usual result of a month: average income − expense of the last complete months with movement. */
export function usualResult(history: MonthTrend[]): { base: number; observed: number } {
  const ms = history.filter((m) => m.income > 0 || m.expense > 0);
  if (!ms.length) return { base: 0, observed: 0 };
  return { base: r2(ms.reduce((s, m) => s + m.income - m.expense, 0) / ms.length), observed: ms.length };
}

export function buildProjection({ months, flows, history }: { months: string[]; flows: Record<string, Flow | undefined>; history: MonthTrend[] }): ProjectionView {
  const { base, observed } = usualResult(history);
  const list: ProjectionMonth[] = months.map((month) => {
    const items: ProjectionItem[] = (flows[month]?.upcoming ?? [])
      // the usual (fixed bills, subscriptions, repeated ones) is already in the average
      .filter((u) => !isSuggestion(u) && u.kind !== "fixa")
      .map((u) => ({ key: upcomingKey(u), name: u.name, date: u.date, value: r2(u.value), type: u.type, state: (stateOf(u) === "estimativa" ? "estimativa" : "agendado") as ProjectionItem["state"], transaction_id: u.transaction_id ?? null }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const total = r2(base + items.reduce((s, i) => s + (i.type === "receita" ? i.value : -i.value), 0));
    return { month, items, base, total };
  });
  const negative = list.filter((m) => m.total < 0);
  const worst = negative.reduce<ProjectionMonth | null>((a, m) => (!a || m.total < a.total ? m : a), null);
  const big = list.flatMap((m) => m.items).filter((i) => i.type === "despesa" && base > 0 && i.value >= base * 0.5);
  const bigTotal = r2(big.reduce((s, i) => s + i.value, 0));
  return {
    base, monthsObserved: observed, months: list, negative, worst,
    sum: r2(list.reduce((s, m) => s + m.total, 0)),
    yearly: negative.length && big.length ? { total: bigTotal, perMonth: Math.ceil(bigTotal / Math.max(1, list.length)), items: big } : null,
  };
}
