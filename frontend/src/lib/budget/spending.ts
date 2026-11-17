/**
 * Orçamento · tela 2 (Gastos do mês): the month's day-to-day spending against the limits, computed on the device from
 * the Fluxo records and the category limits. Read only.
 *
 * Two ways to count, as approved in the prototype:
 * - "Quando comprou": every purchase on the day it was made, card included. This is what the category limits use.
 * - "Quando sai da conta": only what left an account (debit, Pix, vales). Card purchases leave when the invoice is paid;
 *   this is what the livre and the projection use.
 */
import type { Account, Transaction } from "@/types/finnos";
import type { CategoryLimit } from "@/lib/budget/monthView";

export type Pace = "dentro" | "acelerado" | "acima";

export interface CategorySpending extends CategoryLimit {
  projected: number;
  /** What the pace says it will pass the limit by (0 when it closes inside). */
  passBy: number;
  /** Still allowed per day until the end of the month. */
  perDay: number;
  items: Transaction[];
}

export interface SpendingView {
  month: string;
  day: number;
  days: number;
  elapsed: number;
  spent: number;
  planned: number;
  projected: number;
  pace: Pace;
  /** The category that pulls the difference the most (largest projected excess). */
  driver: CategorySpending | null;
  categories: CategorySpending[];
  byPurchase: number;
  leftAccounts: number;
  /** Card purchases of the month that only leave the account when the invoice is paid. */
  onCards: number;
  origins: { id: "conta" | "cartao" | "beneficio"; label: string; value: number }[];
  weeks: { label: string; value: number; future: boolean; current: boolean }[];
  recent: Transaction[];
  tip: { category: string; perDay: number; until: string } | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const amount = (t: Transaction) => (t.installment ? t.installment_value ?? t.value : t.value);

/** A day-to-day spending record of the month (no transfer, invoice payment, balance correction or refund). */
export function isSpending(t: Transaction, month: string, today: string): boolean {
  return t.type === "despesa" && t.status === "pago" && t.date.slice(0, 7) === month && t.date <= today
    && !t.invoice_payment && !t.balance_adjustment && !t.invoice_refund;
}

/** Paid once in the month (a fixed bill, a subscription, an installment): it does not repeat at the daily pace. */
function isFixedCost(t: Transaction): boolean {
  return t.fixed || !!t.recurrence_id || t.installment;
}

export function buildSpendingView({ month, today, categories, transactions, accounts, monthExpense }: {
  month: string; today: string; categories: CategoryLimit[]; transactions: Transaction[]; accounts: Account[];
  /** The month's spending by competência (Fluxo), card installments included. */
  monthExpense?: number;
}): SpendingView {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const thisMonth = today.slice(0, 7);
  const day = month < thisMonth ? days : month > thisMonth ? 0 : Number(today.slice(8));
  const elapsed = day / days;
  const left = days - day;
  const benefit = new Set(accounts.filter((a) => a.type === "beneficio").map((a) => a.id));
  const spending = transactions.filter((t) => isSpending(t, month, today));

  // The pace projects only the variable part; fixed costs already paid stay as they are.
  const fixedBy = new Map<string, number>();
  for (const t of spending) if (isFixedCost(t) && t.category_id) fixedBy.set(t.category_id, (fixedBy.get(t.category_id) ?? 0) + amount(t));
  const pace = (spent: number, fixed: number) => { const f = Math.min(fixed, spent); return day ? r2(f + ((spent - f) / day) * days) : spent; };
  const cats: CategorySpending[] = categories.map((c) => {
    const projected = pace(c.spent, fixedBy.get(c.category_id) ?? 0);
    const passBy = r2(Math.max(0, projected - c.limit));
    return {
      ...c, projected, passBy,
      perDay: left > 0 ? Math.max(0, Math.floor(((c.limit - c.spent) / left) * 100) / 100) : 0,
      items: spending.filter((t) => t.category_id === c.category_id).sort((a, b) => b.date.localeCompare(a.date)),
    };
  });
  const spent = r2(cats.reduce((s, c) => s + c.spent, 0));
  const planned = r2(cats.reduce((s, c) => s + c.limit, 0));
  const projected = r2(cats.reduce((s, c) => s + c.projected, 0));
  const ratio = planned ? projected / planned : 0;
  const status: Pace = spent > planned && planned > 0 ? "acima" : ratio > 1.03 || cats.some((c) => c.passBy > 0) ? "acelerado" : "dentro";
  const driver = [...cats].filter((c) => c.passBy > 0).sort((a, b) => b.passBy - a.passBy)[0] ?? null;

  // "Quando comprou" is the month's competência (card installments included); "quando sai da conta" is what left an
  // account: debit, Pix and vales, plus the card invoices paid in the month.
  const nonCard = r2(spending.filter((t) => !t.card_id).reduce((s, t) => s + amount(t), 0));
  const onBenefit = r2(spending.filter((t) => !t.card_id && benefit.has(t.account_id)).reduce((s, t) => s + amount(t), 0));
  const invoicesPaid = r2(transactions.filter((t) => t.invoice_payment && t.status === "pago" && t.date.slice(0, 7) === month && t.date <= today).reduce((s, t) => s + t.value, 0));
  const byPurchase = r2(monthExpense ?? spending.reduce((s, t) => s + amount(t), 0));
  const onCards = r2(Math.max(0, byPurchase - nonCard));
  const leftAccounts = r2(nonCard + invoicesPaid);

  const weeks: SpendingView["weeks"] = [];
  for (let start = 1; start <= days; start += 7) {
    const end = Math.min(days, start + 6);
    const value = r2(spending.filter((t) => { const d = Number(t.date.slice(8)); return d >= start && d <= end; }).reduce((s, t) => s + amount(t), 0));
    weeks.push({ label: `${start}–${end}`, value, future: day < start, current: day >= start && day <= end });
  }

  // The tip helps a category that can still close inside its limit; one already over has nothing left per day.
  const tipCat = [...cats].filter((c) => c.passBy > 0 && c.spent < c.limit).sort((a, b) => b.passBy - a.passBy)[0] ?? null;
  const until = `${String(days).padStart(2, "0")}/${month.slice(5)}`;
  return {
    month, day, days, elapsed, spent, planned, projected, pace: status, driver, categories: cats,
    byPurchase, leftAccounts, onCards,
    origins: [
      { id: "conta", label: "Conta e Pix", value: r2(nonCard - onBenefit) },
      { id: "cartao", label: "Cartão de crédito", value: onCards },
      { id: "beneficio", label: "VR / VA", value: onBenefit },
    ],
    weeks,
    recent: [...spending].sort((a, b) => b.date.localeCompare(a.date)),
    tip: tipCat && left > 0 ? { category: tipCat.name, perDay: tipCat.perDay, until } : null,
  };
}
