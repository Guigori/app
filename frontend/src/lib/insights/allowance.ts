/** "Quanto posso gastar hoje": what is left of the month after what was spent and what is still scheduled, split by the days left. */
import type { CalendarMonth } from "@/types/finnos";

const round2 = (n: number) => Math.round(n * 100) / 100;
const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); };

export interface Allowance {
  /** Where the month's money comes from: the budget when there is one, otherwise the income. */
  base: number;
  source: "orcamento" | "renda";
  spent: number;
  scheduled: number;
  available: number;
  daysLeft: number;
  /** What can go out today (before today's spending). */
  perDay: number;
  spentToday: number;
  todayLeft: number;
  /** Share of the base already used or committed. */
  used: number;
}

export function dailyAllowance(calendar: Pick<CalendarMonth, "month" | "days" | "income" | "expense" | "projected_income">, plannedBudget: number, today: string): Allowance {
  const source = plannedBudget > 0 ? "orcamento" : "renda";
  const base = round2(plannedBudget > 0 ? plannedBudget : calendar.income + calendar.projected_income);
  const spent = round2(calendar.expense);
  // Still to go out this month: what is scheduled from today on (today's paid spending is already in `spent`).
  const scheduled = round2(calendar.days.filter((d) => d.date >= today).reduce((s, d) => s + d.projected_expense, 0));
  const spentToday = round2(calendar.days.find((d) => d.date === today)?.expense ?? 0);
  const isCurrent = today.slice(0, 7) === calendar.month;
  const daysLeft = isCurrent ? lastDay(calendar.month) - Number(today.slice(8, 10)) + 1 : 1;
  const available = round2(base - spent - scheduled);
  const perDay = round2(Math.max(0, available + spentToday) / daysLeft);
  return {
    base, source, spent, scheduled, available, daysLeft, perDay, spentToday,
    todayLeft: round2(perDay - spentToday),
    used: base > 0 ? (spent + scheduled) / base : 0,
  };
}
