import { describe, expect, it } from "vitest";
import type { Account, CalendarMonth, CreditCard, Transaction } from "@/types/finnos";
import { nextInvoices, weekAhead } from "./upcoming";
import { dailyAllowance } from "./allowance";
import { balanceForecast } from "./forecast";

const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t", name: "Item", value: 100, type: "despesa", status: "agendado", date: "2026-11-12", account_id: "a", account_name: "Inter",
  card_id: null, card_name: null, to_account_id: null, to_account_name: null, category_id: null, category_name: null,
  category_color: null, category_icon: null, fixed: false, recurrence: null, installment: false, total_installments: null,
  current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null, created_at: "", ...over,
} as Transaction);
const card = (over: Partial<CreditCard>): CreditCard => ({
  id: "c6", name: "C6", institution: "C6", color: "#222", limit: 5000, closing_day: 5, due_day: 12, payment_account_id: "a", payment_account_name: "Inter",
  active: true, invoice_paid: false, current_invoice: 130, future_installments: 0, used: 0, available: 0, used_percent: 0,
  cycle_start: "2026-11-06", next_closing: "2026-12-05", next_due: "2026-12-12", best_purchase_day: "2026-12-06", created_at: "", ...over,
} as CreditCard);
const account = (balance: number): Account => ({ id: "a", name: "Inter", institution: "Inter", type: "corrente", color: "", initial_balance: 0, active: true, balance, total_income: 0, total_expense: 0, created_at: "" } as Account);

describe("next invoices", () => {
  it("pays the closed invoice first and says whether the account covers each one", () => {
    const cards = [card({ payable_cycle: "2026-11-05", payable_invoice: 412.36, payable_due: "2026-11-12" }), card({ id: "nu", name: "Nubank", current_invoice: 300, next_due: "2026-11-28", next_closing: "2026-11-20" })];
    const r = nextInvoices(cards, [account(500)], "2026-11-10");
    expect(r.map((i) => [i.cardName, i.amount, i.closed, i.days, i.covers])).toEqual([["C6", 412.36, true, 2, true], ["Nubank", 300, false, 18, false]]);
    expect(r[1]).toMatchObject({ balanceBefore: 87.64, shortfall: 212.36 });
  });
  it("skips paid or empty invoices", () => {
    expect(nextInvoices([card({ invoice_paid: true }), card({ id: "x", current_invoice: 0 })], [], "2026-11-10")).toEqual([]);
  });
});

describe("week ahead", () => {
  it("joins bank bills, invoices and subscriptions of the next 7 days, without card purchases or repeats", () => {
    const invoices = nextInvoices([card({ payable_cycle: "2026-11-05", payable_invoice: 412.36, payable_due: "2026-11-12" })], [account(1000)], "2026-11-10");
    const r = weekAhead([
      tx({ id: "1", name: "Vivo", value: 41.99, date: "2026-11-11" }),
      tx({ id: "2", name: "Compra", card_id: "c6", date: "2026-11-11" }),
      tx({ id: "3", name: "Salário", type: "receita", value: 3000, date: "2026-11-15" }),
      tx({ id: "4", name: "Aluguel", value: 1000, date: "2026-11-20" }),
      tx({ id: "5", name: "Google", value: 11.99, date: "2026-11-14" }),
    ], invoices, [
      { date: "2026-11-14", subscription_id: "g", name: "Google", value: 11.99, account_id: "a", card_id: null, category_id: null },
      { date: "2026-11-13", subscription_id: "s", name: "Spotify", value: 21.9, account_id: null, card_id: "c6", category_id: null },
    ], "2026-11-10");
    expect(r.items.map((i) => i.name)).toEqual(["Vivo", "Fatura C6", "Google", "Salário"]);
    expect(r).toMatchObject({ out: 466.34, income: 3000, heaviest: { date: "2026-11-12", total: 412.36 } });
  });
});

describe("daily allowance", () => {
  const calendar: Pick<CalendarMonth, "month" | "days" | "income" | "expense" | "projected_income"> = {
    month: "2026-11", income: 5000, projected_income: 0, expense: 2000,
    days: [
      { date: "2026-11-10", income: 0, expense: 50, projected_income: 0, projected_expense: 0, count: 1, active_count: 1 },
      { date: "2026-11-20", income: 0, expense: 0, projected_income: 0, projected_expense: 1000, count: 1, active_count: 1 },
    ],
  };
  it("splits what is left of the budget by the days left, today included", () => {
    const r = dailyAllowance(calendar, 4000, "2026-11-10");
    expect(r).toMatchObject({ source: "orcamento", available: 1000, daysLeft: 21, spentToday: 50, perDay: 50, todayLeft: 0 });
    expect(r.used).toBe(0.75);
  });
  it("uses the income when there is no budget", () => {
    expect(dailyAllowance(calendar, 0, "2026-11-10")).toMatchObject({ source: "renda", base: 5000, available: 2000 });
  });
});

describe("balance forecast", () => {
  it("is real up to today and adds scheduled bank lançamentos, invoices and subscriptions after", () => {
    const history = { month: "2026-11", opening_balance: 1000, days: [{ date: "2026-11-01", balance: 1000 }, { date: "2026-11-10", balance: 800 }], balance: 800 };
    const invoices = nextInvoices([card({ payable_cycle: "2026-11-05", payable_invoice: 400, payable_due: "2026-11-12" })], [account(800)], "2026-11-10");
    const r = balanceForecast(history, [
      tx({ name: "Aluguel", value: 1000, date: "2026-11-15" }),
      tx({ name: "Salário", type: "receita", value: 3000, date: "2026-11-25" }),
      tx({ name: "Compra", card_id: "c6", value: 999, date: "2026-11-11" }),
    ], invoices, [{ date: "2026-11-18", subscription_id: "x", name: "Academia", value: 100, account_id: "a", card_id: null, category_id: null }], "2026-11-10");
    expect(r).toMatchObject({ today: 800, end: 2300, change: 1500, incoming: 3000, outgoing: 1500, firstNegative: "2026-11-15" });
    expect(r.lowest).toMatchObject({ date: "2026-11-18", value: -700 });
    expect(r.series[0]).toMatchObject({ kind: "real" });
    expect(r.series.at(-1)).toMatchObject({ date: "2026-11-30", kind: "previsto", value: 2300 });
  });
});
