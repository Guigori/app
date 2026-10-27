import { beforeEach, afterEach, expect, it, vi } from "vitest";
import parity from "../../../fixtures/finance-ledger-parity.json";
import { freshDb, writeDb } from "./store";
import { localDashboard, localFlow, localBudget, localCalendar, localListAccounts } from "./engine";
import type { Transaction, Account, SubscriptionItem, Category } from "@/types/finnos";

vi.mock("@/lib/mode", () => ({ getMode: () => "local", isLocalMode: () => true }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T14:00:00.000Z"));
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("matches the shared Python ledger's cash, income, refunds, categories, calendar and forecasts", () => {
  const db = freshDb("Parity synthetic");
  db.accounts = parity.accounts.map(row => ({
    ...row, name: row.id, institution: "Test", institution_id: null,
    type: "corrente", color: "#070F52", active: true,
    created_at: "2026-01-01T00:00:00Z", balance: row.initial_balance,
    total_income: 0, total_expense: 0,
  })) as Account[];
  db.categories = [
    { id: "rent", name: "Moradia", group: "necessidades", monthly_budget: 1500 },
    { id: "shopping", name: "Compras", group: "desejos", monthly_budget: 300 },
    { id: "streaming", name: "Assinaturas", group: "desejos", monthly_budget: 100 },
  ].map(row => ({
    ...row, color: "#070F52", icon: "wallet",
    monthly_goal: 0, created_at: "2026-01-01T00:00:00Z",
  })) as Category[];
  db.transactions = parity.transactions.map(tx => ({
    ...tx,
    to_account_id: "to_account_id" in tx ? tx.to_account_id : null,
    fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null,
    installment_value: null, adjusted_value: null,
    created_at: "2026-10-26T00:00:00Z",
  })) as Transaction[];
  const merchant = parity.credit_events.find(e => e.kind === "merchant_credit")!;
  const refund = parity.credit_events.find(e => e.kind === "bank_refund")!;
  db.cards = [{
    id: "card", name: "Cartão", closing_day: 29, due_day: 7,
    institution: "Test", institution_id: null, limit: 2000,
    payment_account_id: "bank", color: "#070F52", active: false,
    created_at: "2026-01-01T00:00:00Z",
    invoice_adjustments: {
      [merchant.cycle]: [{
        id: merchant.id, purchase_id: merchant.purchase_id,
        date: merchant.date, value: merchant.value, reason: "Synthetic",
      }],
    },
    invoice_refunds: {
      [refund.cycle]: [{
        id: refund.id, purchase_id: refund.purchase_id,
        date: refund.date, value: refund.value, account_id: "bank",
        reason: "Synthetic",
      }],
    },
  }];
  db.subscriptions = [{
    ...parity.subscription, account_name: "Banco",
    category_name: "Assinaturas", category_color: null,
    card_name: null, notes: null,
  }] as SubscriptionItem[];
  writeDb(db);

  const expected = parity.expected;
  const dashboard = localDashboard(parity.month);
  expect(dashboard.income).toBe(expected.income);
  expect(dashboard.expense).toBe(expected.expense);
  expect(dashboard.month_balance).toBe(expected.net);
  expect(dashboard.total_balance).toBe(expected.total_balance);

  const accounts = Object.fromEntries(localListAccounts().map(a => [a.id, a.balance]));
  expect(accounts).toEqual(expected.balance_by_account);

  const flow = localFlow({ month: parity.month, months: 2 });
  expect(flow.income).toBe(expected.income);
  expect(flow.expense).toBe(expected.expense);
  expect(flow.projected_expense).toBe(expected.projected_expense);

  // The net month includes a -R$150 refund in shopping, but the visual
  // spending breakdown must not render negative bars or 117% rent.
  expect(flow.categories.map(item => ({
    category_id: item.category_id, total: item.total, percent: item.percent,
  }))).toEqual([{ category_id: "rent", total: 1000, percent: 100 }]);

  const calendar = localCalendar(parity.month);
  expect(calendar.income).toBe(expected.income);
  expect(calendar.expense).toBe(expected.expense);
  expect(calendar.net).toBe(expected.net);
  expect(calendar.projected_expense).toBe(expected.projected_expense);
  expect(calendar.days.find(day => day.date === parity.today)?.expense)
    .toBe(expected.calendar_expense_on_refund_day);
  expect(calendar.days.find(day => day.date === parity.today)?.income).toBe(0);
  const budget = localBudget(parity.month);
  expect(budget.spent).toBe(expected.expense);
});
