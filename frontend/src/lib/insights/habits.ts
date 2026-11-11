/** Comportamento, renda e histórico: readings for the library's habit, income and six-month analyses. */
import type { DayFlow, FlowPoint, UpcomingItem } from "@/types/finnos";

export const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00`).getDay();

export interface SpendingHabits {
  /** Days of the month that already happened. */
  daysSoFar: number;
  spentDays: number;
  quietDays: number;
  total: number;
  perDay: number;
  peak: { date: string; expense: number } | null;
  /** Average spent on each weekday that already happened (0 = domingo). */
  byWeekday: Array<{ weekday: number; average: number; days: number }>;
  topWeekday: { weekday: number; average: number } | null;
  /** Share of the month's spending that happened on Friday to Sunday. */
  weekendShare: number;
}

export function spendingHabits(days: DayFlow[], today: string): SpendingHabits {
  const past = days.filter((d) => d.date <= today);
  const total = past.reduce((s, d) => s + Math.max(0, d.expense), 0);
  const spent = past.filter((d) => d.expense > 0);
  const peak = spent.reduce<SpendingHabits["peak"]>((m, d) => (!m || d.expense > m.expense ? { date: d.date, expense: d.expense } : m), null);
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => {
    const list = past.filter((d) => weekdayOf(d.date) === weekday);
    const sum = list.reduce((s, d) => s + Math.max(0, d.expense), 0);
    return { weekday, average: list.length ? sum / list.length : 0, days: list.length };
  });
  const top = byWeekday.filter((w) => w.average > 0).sort((a, b) => b.average - a.average)[0];
  const weekend = past.filter((d) => [0, 5, 6].includes(weekdayOf(d.date))).reduce((s, d) => s + Math.max(0, d.expense), 0);
  return {
    daysSoFar: past.length,
    spentDays: spent.length,
    quietDays: past.length - spent.length,
    total,
    perDay: past.length ? total / past.length : 0,
    peak,
    byWeekday,
    topWeekday: top ? { weekday: top.weekday, average: top.average } : null,
    weekendShare: total > 0 ? weekend / total : 0,
  };
}

export interface IncomeReading {
  received: number;
  toCome: number;
  expected: number;
  /** What is still expected, by date. */
  next: UpcomingItem[];
  /** Share of the month's spending the income covers (expense / income). */
  committed: number;
}

export function incomeReading(received: number, expense: number, upcoming: UpcomingItem[] | undefined): IncomeReading {
  const next = (upcoming ?? []).filter((u) => u.type === "receita").sort((a, b) => a.date.localeCompare(b.date));
  const toCome = next.reduce((s, u) => s + u.value, 0);
  const expected = received + toCome;
  return { received, toCome, expected, next, committed: expected > 0 ? expense / expected : 0 };
}

export interface MonthsReading {
  months: FlowPoint[];
  averageExpense: number;
  averageIncome: number;
  /** Months that closed with more coming in than going out. */
  positive: number;
  best: FlowPoint | null;
  worst: FlowPoint | null;
  /** This month's expense against the average of the closed months before it. */
  current: FlowPoint | null;
}

/** The last `count` months up to `focus` (closed ones and the current), ignoring the future ones a flow may carry. */
export function lastMonths(series: FlowPoint[], focus: string, count = 6): MonthsReading {
  const months = series.filter((p) => p.month <= focus).sort((a, b) => a.month.localeCompare(b.month)).slice(-count);
  const closed = months.filter((p) => p.month < focus);
  const avg = (f: (p: FlowPoint) => number) => (closed.length ? closed.reduce((s, p) => s + f(p), 0) / closed.length : 0);
  const byNet = [...closed].sort((a, b) => b.net - a.net);
  return {
    months,
    averageExpense: avg((p) => p.expense),
    averageIncome: avg((p) => p.income),
    positive: closed.filter((p) => p.net > 0).length,
    best: byNet[0] ?? null,
    worst: byNet.at(-1) ?? null,
    current: months.find((p) => p.month === focus) ?? null,
  };
}
