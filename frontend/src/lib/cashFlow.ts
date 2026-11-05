/** Calculations for the Fluxo de caixa screen. Values in BRL (2 decimals). */
import type { DayFlow, FlowPoint, Transaction } from "@/types/finnos";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How the month closes: what already happened plus what is still expected. */
export function monthClose(point: Pick<FlowPoint, "net" | "projected_net">): number {
  return round2(point.net + point.projected_net);
}

export interface BalancePoint {
  month: string;
  label: string;
  /** Estimated balance at the end of a past month (solid line). */
  real: number | null;
  /** Expected balance at the end of the current and future months (dashed line). */
  forecast: number | null;
}

/**
 * Balance month by month, anchored on today's balance.
 * Past month ends walk back from today by each later month's realised result; the
 * current month and the future add what is still expected (scheduled, pending,
 * installments and recurring costs). An estimate: it ignores investment income.
 */
export function balanceTimeline(series: FlowPoint[], todayBalance: number, currentMonth: string): BalancePoint[] {
  const idx = series.findIndex((p) => p.month === currentMonth);
  if (idx < 0) return series.map((p) => ({ month: p.month, label: p.label, real: null, forecast: null }));
  const out: BalancePoint[] = series.map((p) => ({ month: p.month, label: p.label, real: null, forecast: null }));
  // Start of the current month = today − what already happened this month.
  let end = round2(todayBalance - series[idx].net);
  for (let i = idx - 1; i >= 0; i--) {
    out[i].real = end;
    end = round2(end - series[i].net);
  }
  let forecast = round2(todayBalance + series[idx].projected_net);
  out[idx].forecast = forecast;
  // The line starts where the real one ends, so both read as one path.
  if (idx > 0) out[idx - 1].forecast = out[idx - 1].real;
  for (let i = idx + 1; i < series.length; i++) {
    forecast = round2(forecast + series[i].net + series[i].projected_net);
    out[i].forecast = forecast;
  }
  return out;
}

export interface WeekFlow {
  label: string;
  income: number;
  expense: number;
  net: number;
}

/** Realised income and expenses per week of the month (weeks start on the 1st, 8th, 15th, 22nd, 29th). */
export function weeklyFlow(month: string, days: DayFlow[]): WeekFlow[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const weeks: WeekFlow[] = [];
  for (let start = 1; start <= last; start += 7) {
    const end = Math.min(start + 6, last);
    const inWeek = days.filter((d) => d.date.startsWith(month) && Number(d.date.slice(8, 10)) >= start && Number(d.date.slice(8, 10)) <= end);
    const income = round2(inWeek.reduce((s, d) => s + d.income, 0));
    const expense = round2(inWeek.reduce((s, d) => s + d.expense, 0));
    weeks.push({ label: `${start}–${end}`, income, expense, net: round2(income - expense) });
  }
  return weeks;
}

export interface Source {
  key: string;
  name: string;
  color: string | null;
  total: number;
  count: number;
}

/** Received income of the month grouped by category (or by name when uncategorised). */
export function incomeSources(transactions: Transaction[], month: string): Source[] {
  const groups = new Map<string, Source>();
  for (const t of transactions) {
    if (t.type !== "receita" || t.status !== "pago" || !t.date.startsWith(month)) continue;
    const key = t.category_id ?? `name:${t.name.toLocaleLowerCase("pt-BR")}`;
    const g = groups.get(key) ?? { key, name: t.category_name ?? t.name, color: t.category_color, total: 0, count: 0 };
    g.total = round2(g.total + (t.adjusted_value ?? t.value));
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

/** Scheduled or pending entries of the month that have not happened yet, by date. */
export function upcoming(transactions: Transaction[], month: string): Transaction[] {
  return transactions
    .filter((t) => (t.type === "receita" || t.type === "despesa") && t.status !== "pago" && t.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || b.value - a.value);
}
