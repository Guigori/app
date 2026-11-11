/** Installment purchases still running: where each one is, what is left and how it weighs on the next months. */
import { addMonth } from "@/lib/format";
import type { Transaction } from "@/types/finnos";

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));

export interface InstallmentPlan {
  id: string;
  name: string;
  cardId: string | null;
  where: string;
  count: number;
  /** Number of the installment that falls in `fromMonth` (0 when it only starts later). */
  current: number;
  /** Installments after the current one. */
  left: number;
  value: number;
  total: number;
  /** What is still to pay after the current installment. */
  remaining: number;
  endMonth: string;
  startMonth: string;
}

/** A card's rule for what enters each invoice: purchases up to the closing day go to that month's invoice. */
export interface CardRule { closing_day: number; next_closing: string }

/** Invoice (closing month) a card purchase enters: on or before the closing day → this month, after it → next month. */
export function invoiceMonthOf(date: string, closingDay: number): string {
  const month = date.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const closing = Math.min(closingDay, new Date(y, m, 0).getDate());
  return Number(date.slice(8, 10)) <= closing ? month : addMonth(month, 1);
}

/** Installment number that falls in a month for a purchase whose first installment is in `startMonth` (null outside of it). */
export function installmentNumberIn(tx: Pick<Transaction, "current_installment" | "total_installments">, startMonth: string, month: string): number | null {
  const count = tx.total_installments ?? 1;
  const n = (tx.current_installment ?? 1) + monthsBetween(startMonth, month);
  return n >= 1 && n <= count ? n : null;
}

/**
 * Installments still running. Card purchases follow the card's invoices: the first installment goes to the
 * invoice the purchase entered (closing day rule) and "now" is the card's open invoice. Others follow the calendar month.
 */
export function installmentPlans(transactions: Transaction[], fromMonth: string, cardId?: string | null, cards?: Map<string, CardRule>): InstallmentPlan[] {
  return transactions
    .filter((t) => t.type === "despesa" && t.installment && (t.total_installments ?? 1) > 1 && (!cardId || t.card_id === cardId))
    .map((t) => {
      const count = t.total_installments ?? 1;
      const value = round2(t.installment_value ?? (t.adjusted_value ?? t.value) / count);
      const first = t.current_installment ?? 1;
      const rule = t.card_id ? cards?.get(t.card_id) : undefined;
      const startMonth = rule ? invoiceMonthOf(t.date, rule.closing_day) : t.date.slice(0, 7);
      const now = rule ? rule.next_closing.slice(0, 7) : fromMonth;
      const endMonth = addMonth(startMonth, count - first);
      const inMonth = installmentNumberIn(t, startMonth, now);
      const notStarted = monthsBetween(now, startMonth) > 0;
      const current = inMonth ?? 0;
      const left = notStarted ? count - first + 1 : inMonth ? count - inMonth : 0;
      return {
        id: t.id, name: t.name, cardId: t.card_id ?? null, where: t.card_id ? t.card_name ?? "" : t.account_name ?? "",
        count, current, left, value, total: round2(value * count), remaining: round2(value * left), endMonth, startMonth,
      };
    })
    .filter((p) => p.current > 0 || p.left > 0)
    .sort((a, b) => b.remaining - a.remaining || a.endMonth.localeCompare(b.endMonth));
}

export interface ScheduleMonth { month: string; total: number; count: number; ending: string[] }

/** Month by month: what the running installments cost and which ones end there. */
export function installmentSchedule(plans: InstallmentPlan[], fromMonth: string, months = 6): ScheduleMonth[] {
  return Array.from({ length: months }, (_, i) => {
    const month = addMonth(fromMonth, i);
    const active = plans.filter((p) => monthsBetween(p.startMonth, month) >= 0 && monthsBetween(month, p.endMonth) >= 0);
    return {
      month,
      total: round2(active.reduce((s, p) => s + p.value, 0)),
      count: active.length,
      ending: active.filter((p) => p.endMonth === month).map((p) => p.name),
    };
  });
}

export interface BudgetPressure { month: string; installments: number; fixed: number; committed: number; share: number | null }

/** How much of the monthly budget is already taken by installments (and fixed costs) in each month ahead. */
export function budgetPressure(schedule: ScheduleMonth[], planned: number, fixedMonthly = 0): BudgetPressure[] {
  return schedule.map((m) => {
    const committed = round2(m.total + fixedMonthly);
    return { month: m.month, installments: m.total, fixed: round2(fixedMonthly), committed, share: planned > 0 ? committed / planned : null };
  });
}

export interface InstallmentsSummary { plans: InstallmentPlan[]; monthly: number; remaining: number; endingSoon: InstallmentPlan[]; freedNextMonth: number }

export function summarizeInstallments(plans: InstallmentPlan[], fromMonth: string): InstallmentsSummary {
  const active = plans.filter((p) => p.current > 0);
  return {
    plans,
    monthly: round2(active.reduce((s, p) => s + p.value, 0)),
    remaining: round2(plans.reduce((s, p) => s + p.remaining, 0)),
    endingSoon: active.filter((p) => p.left <= 1),
    // Installments paying their last one this month: from next month this money is free.
    freedNextMonth: round2(active.filter((p) => p.endMonth === fromMonth).reduce((s, p) => s + p.value, 0)),
  };
}
