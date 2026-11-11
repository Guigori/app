/** "vs mês passado": how a number moved and whether that is good news. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Comparison { delta: number; pct: number | null; better: boolean | null; same: boolean }

/** `betterWhen` says which direction is good (spending: lower; balance, savings: higher). */
export function compare(current: number, previous: number | null | undefined, betterWhen: "lower" | "higher"): Comparison | null {
  if (previous == null || !Number.isFinite(previous)) return null;
  const delta = round2(current - previous);
  const same = Math.abs(delta) < 0.005;
  return {
    delta,
    pct: previous !== 0 ? delta / Math.abs(previous) : null,
    better: same ? null : betterWhen === "lower" ? delta < 0 : delta > 0,
    same,
  };
}

/** Sum of the expense of the days of a month up to a day number (the same point of the month). */
export function expenseUntilDay(days: Array<{ date: string; expense: number }>, day: number): number {
  return round2(days.filter((d) => Number(d.date.slice(8, 10)) <= day).reduce((s, d) => s + d.expense, 0));
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const shortMonthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
