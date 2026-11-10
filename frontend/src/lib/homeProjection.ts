/**
 * Rows of the Home "Projeção" chart, apart from the screen so the numbers can be tested.
 *
 * - Saldo: the money in the accounts on each real day (BalanceHistory, same rule as
 *   "Saldo total"); after today, that balance plus what is still expected each day.
 * - Receitas / Despesas: what was received and spent in the month up to each day
 *   (calendar, competency: a card purchase counts on its purchase day); after today,
 *   plus what is expected.
 */
import type { BalanceHistory, DayFlow } from "@/types/finnos";

export type ProjectionKey = "balance" | "income" | "expense";
export const PROJECTION_KEYS: ProjectionKey[] = ["balance", "income", "expense"];

export type ProjectionRow = Record<string, number | string | null>;

const cents = (value: number) => Math.round(value * 100) / 100;

/** How many days of the month already happened: all of a past month, none of a future one. */
export function realDays(month: string, today: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const current = today.slice(0, 7);
  if (month === current) return Math.min(Number(today.slice(8, 10)), daysInMonth);
  return month < current ? daysInMonth : 0;
}

export function buildProjectionRows({ month, days, history, total, today }: {
  month: string;
  days: DayFlow[];
  /** Missing while loading or on an older server: falls back to today's total. */
  history?: BalanceHistory;
  /** "Saldo total" today. */
  total: number;
  today: string;
}): ProjectionRow[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const cutoffDay = realDays(month, today);
  const key = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
  const flows = new Map(days.map((day) => [day.date, day]));
  const balances = new Map((history?.days ?? []).map((day) => [day.date, day.balance]));

  // Without the history, the old estimate: today's total walked back through the month.
  let realisedNet = 0;
  for (let n = 1; n <= cutoffDay; n += 1) realisedNet += (flows.get(key(n))?.income ?? 0) - (flows.get(key(n))?.expense ?? 0);
  const fallbackOpening = total - realisedNet;

  let income = 0;
  let expense = 0;
  let fallbackBalance = fallbackOpening;
  let balance = history?.opening_balance ?? (cutoffDay === 0 ? total : fallbackOpening);
  const rows: ProjectionRow[] = [];
  for (let n = 1; n <= daysInMonth; n += 1) {
    const flow = flows.get(key(n));
    const real = n <= cutoffDay;
    if (real) {
      income += flow?.income ?? 0;
      expense += flow?.expense ?? 0;
      fallbackBalance += (flow?.income ?? 0) - (flow?.expense ?? 0);
      balance = history ? (balances.get(key(n)) ?? balance) : fallbackBalance;
    } else {
      income += flow?.projected_income ?? 0;
      expense += flow?.projected_expense ?? 0;
      balance += (flow?.projected_income ?? 0) - (flow?.projected_expense ?? 0);
    }
    const row: ProjectionRow = { label: String(n).padStart(2, "0"), estimate: real ? 0 : 1 };
    const values: Record<ProjectionKey, number> = { balance, income, expense };
    for (const series of PROJECTION_KEYS) {
      const value = cents(values[series]);
      row[`${series}Actual`] = real ? value : null;
      // The dashed estimate starts on today, so the two lines meet.
      row[`${series}Forecast`] = n >= cutoffDay ? value : null;
    }
    rows.push(row);
  }
  return rows;
}
