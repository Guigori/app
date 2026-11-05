/** Pure calculations behind the Análise sub-screens. Values in BRL (2 decimals). */
import type { CategorySlice, DayFlow, MonthTrend, SubscriptionItem, Transaction } from "@/types/finnos";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

/** Share of income kept in the month (null when there was no income). */
export function savingsRate(income: number, expense: number): number | null {
  if (income <= 0) return null;
  return Math.round(((income - expense) / income) * 1000) / 10;
}

export interface EvolutionSummary {
  months: Array<MonthTrend & { rate: number | null; cumulative: number }>;
  avgIncome: number;
  avgExpense: number;
  avgRate: number | null;
  best: MonthTrend | null;
  worst: MonthTrend | null;
}

/** Month-by-month income, expense, result and savings rate; ignores months without movement for averages. */
export function evolution(trend: MonthTrend[]): EvolutionSummary {
  let cumulative = 0;
  const months = trend.map((m) => ({ ...m, rate: savingsRate(m.income, m.expense), cumulative: round2((cumulative += m.net)) }));
  const active = trend.filter((m) => m.income > 0 || m.expense > 0);
  const n = Math.max(active.length, 1);
  const avgIncome = round2(active.reduce((s, m) => s + m.income, 0) / n);
  const avgExpense = round2(active.reduce((s, m) => s + m.expense, 0) / n);
  const sorted = [...active].sort((a, b) => b.net - a.net);
  return { months, avgIncome, avgExpense, avgRate: savingsRate(avgIncome, avgExpense), best: sorted[0] ?? null, worst: sorted.length > 1 ? sorted[sorted.length - 1] : null };
}

export interface CategoryChange {
  id: string;
  name: string;
  color: string;
  icon: string;
  current: number;
  previous: number;
  delta: number;
  /** null when the category had no spending last month (new this month). */
  deltaPct: number | null;
}

/** Category spending this month vs last month, biggest current spending first. */
export function categoryChanges(current: CategorySlice[], previous: CategorySlice[]): CategoryChange[] {
  const key = (s: CategorySlice) => s.category_id ?? `name:${s.name}`;
  const prev = new Map(previous.map((s) => [key(s), s]));
  const ids = new Set([...current.map(key), ...previous.map(key)]);
  return [...ids].map((id) => {
    const c = current.find((s) => key(s) === id);
    const p = prev.get(id);
    const base = c ?? p!;
    const now = round2(c?.total ?? 0);
    const before = round2(p?.total ?? 0);
    return { id, name: base.name, color: base.color, icon: base.icon, current: now, previous: before, delta: round2(now - before), deltaPct: before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null };
  }).sort((a, b) => b.current - a.current || b.previous - a.previous);
}

export interface Rhythm {
  spent: number;
  daysElapsed: number;
  dailyAverage: number;
  /** Where the month ends if the current pace continues (current month only). */
  projection: number | null;
  /** Cumulative spending by day: this month (until today) and the comparison month (whole). */
  curve: Array<{ day: number; current: number | null; previous: number | null }>;
}

export function rhythm(month: string, days: DayFlow[], previousDays: DayFlow[], today: string): Rhythm {
  const total = daysInMonth(month);
  const isCurrent = today.slice(0, 7) === month;
  const daysElapsed = isCurrent ? Number(today.slice(8, 10)) : total;
  const byDay = (list: DayFlow[], m: string) => new Map(list.filter((d) => d.date.startsWith(m)).map((d) => [Number(d.date.slice(8, 10)), d.expense]));
  const now = byDay(days, month);
  const prevMonth = addMonths(month, -1);
  const before = byDay(previousDays, prevMonth);
  const prevTotal = daysInMonth(prevMonth);
  let acc = 0;
  let accPrev = 0;
  const curve = Array.from({ length: Math.max(total, prevTotal) }, (_, i) => {
    const day = i + 1;
    acc += now.get(day) ?? 0;
    accPrev += before.get(day) ?? 0;
    return { day, current: day <= daysElapsed && day <= total ? round2(acc) : null, previous: day <= prevTotal ? round2(accPrev) : null };
  });
  const spent = round2([...now.entries()].filter(([d]) => d <= daysElapsed).reduce((s, [, v]) => s + v, 0));
  const dailyAverage = round2(spent / Math.max(daysElapsed, 1));
  return { spent, daysElapsed, dailyAverage, projection: isCurrent && daysElapsed < total ? round2(dailyAverage * total) : null, curve };
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Average spending per weekday over the given days (only days up to `today`). */
export function weekdayAverages(days: DayFlow[], today: string): Array<{ label: string; average: number; total: number }> {
  const sums = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const d of days) {
    if (d.date > today) continue;
    const w = new Date(`${d.date}T12:00:00`).getDay();
    sums[w].total += d.expense;
    sums[w].count += 1;
  }
  return sums.map((s, i) => ({ label: WEEKDAYS[i], total: round2(s.total), average: round2(s.total / Math.max(s.count, 1)) }));
}

/** Portion of a transaction that falls in a month (installments spread one per month). */
export function monthPortion(tx: Transaction, month: string): number {
  const start = tx.date.slice(0, 7);
  if (tx.installment && (tx.total_installments ?? 1) > 1) {
    const total = tx.total_installments ?? 1;
    const first = tx.current_installment ?? 1;
    const [sy, sm] = start.split("-").map(Number);
    const [y, m] = month.split("-").map(Number);
    const offset = (y - sy) * 12 + (m - sm);
    if (offset < 0 || first + offset > total) return 0;
    return round2(tx.installment_value ?? tx.value / total);
  }
  return start === month ? round2(tx.adjusted_value ?? tx.value) : 0;
}

export interface Commitments {
  /** Next months: installments already bought + recurring fixed costs and subscriptions. */
  months: Array<{ month: string; installments: number; fixed: number; total: number }>;
  fixedItems: Array<{ name: string; value: number; kind: "fixo" | "assinatura" }>;
  installmentItems: Array<{ name: string; value: number; remaining: number }>;
  fixedMonthly: number;
}

export function commitments(transactions: Transaction[], subscriptions: SubscriptionItem[], fromMonth: string, count = 6): Commitments {
  const expenses = transactions.filter((t) => t.type === "despesa");
  // One entry per fixed series: the latest occurrence carries the current value.
  const series = new Map<string, Transaction>();
  for (const t of expenses.filter((t) => t.fixed || t.recurrence)) {
    const k = t.recurrence_id ?? t.name.toLocaleLowerCase("pt-BR");
    const seen = series.get(k);
    if (!seen || seen.date < t.date) series.set(k, t);
  }
  const subs = subscriptions.filter((s) => s.active !== false).map((s) => ({ name: s.name, value: round2(s.recurrence === "anual" ? s.value / 12 : s.value), kind: "assinatura" as const }));
  const subNames = new Set(subs.map((s) => s.name.toLocaleLowerCase("pt-BR")));
  const fixedItems = [
    ...[...series.values()].filter((t) => !subNames.has(t.name.toLocaleLowerCase("pt-BR"))).map((t) => ({ name: t.name, value: round2(t.adjusted_value ?? t.value), kind: "fixo" as const })),
    ...subs,
  ].sort((a, b) => b.value - a.value);
  const fixedMonthly = round2(fixedItems.reduce((s, i) => s + i.value, 0));
  const installmentTxs = expenses.filter((t) => t.installment && (t.total_installments ?? 1) > 1);
  const months = Array.from({ length: count }, (_, i) => {
    const month = addMonths(fromMonth, i);
    const installments = round2(installmentTxs.reduce((s, t) => s + monthPortion(t, month), 0));
    return { month, installments, fixed: fixedMonthly, total: round2(installments + fixedMonthly) };
  });
  const installmentItems = installmentTxs.map((t) => {
    const remaining = Array.from({ length: 36 }, (_, i) => monthPortion(t, addMonths(fromMonth, i))).filter((v) => v > 0).length;
    return { name: t.name, value: round2(t.installment_value ?? t.value / (t.total_installments ?? 1)), remaining };
  }).filter((i) => i.remaining > 0).sort((a, b) => b.value * b.remaining - a.value * a.remaining);
  return { months, fixedItems, installmentItems, fixedMonthly };
}
