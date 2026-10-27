import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("@/lib/mode", () => ({ getMode: () => "local", isLocalMode: () => true }));

import { freshDb, readDb, writeDb, type LocalCard } from "@/lib/local/store";
import { fetchTransactionsPage } from "@/lib/data";
import { localInvoice, localListCards, localFlow, localCreateTransaction, localCreditInvoice, localBankRefund, localDeleteTransaction, localDashboard, localBudget, localFinanceHistory, localCreateAccount, localListAccounts, localCalendar } from "@/lib/local/engine";
import type { Transaction, TransactionInput } from "@/types/finnos";

const date = "2026-10-20";

function purchase(id: string, value: number, currentInstallment = 1, totalInstallments = 1): Transaction {
  return {
    id, name: id, type: "despesa", status: "pago", date,
    value, account_id: "bank", card_id: "card",
    category_id: null, invoice_payment: false,
    installment: totalInstallments > 1, total_installments: totalInstallments > 1 ? totalInstallments : null,
    current_installment: totalInstallments > 1 ? currentInstallment : null,
    created_at: "2026-10-20T12:00:00Z",
  } as Transaction;
}

function setScenario(transactions: Transaction[], paidCycles?: LocalCard["paid_cycles"]): void {
  const db = freshDb("Test");
  db.cards = [{
    id: "card", name: "Cartão", closing_day: 29, due_day: 7, limit: 2000,
    payment_account_id: "bank", institution: "Demo", institution_id: null,
    color: "#070F52", active: true, created_at: "2026-01-01T00:00:00Z",
    paid_cycles: paidCycles,
  }];
  db.accounts = [{
    id: "bank", name: "Banco", initial_balance: 5000,
    institution: "Demo", type: "corrente", color: "#070F52",
    active: true, created_at: "2026-01-01T00:00:00Z",
    balance: 5000, total_income: 0, total_expense: 0,
  }];
  db.transactions = transactions;
  writeDb(db);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T14:00:00Z"));
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  });
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("places imported installment 7/10 in the current invoice and only three future cycles", () => {
  setScenario([purchase("Notebook", 1000, 7, 10)]);
  const invoice = localInvoice("card");
  expect(invoice.items).toHaveLength(1);
  expect(invoice.items[0].installment_label).toBe("7/10");
  expect(invoice.items[0].value).toBe(100);
  const card = localListCards()[0];
  expect(card.current_invoice).toBe(100);
  expect(card.future_installments).toBe(300);
  expect(card.used).toBe(400);

  const flow = localFlow({ month: "2026-10", months: 2 });
  expect(flow.series.find(point => point.month === "2026-10")?.expense).toBe(100);
  expect(flow.series.find(point => point.month === "2026-11")?.expense).toBe(100);
  expect(flow.series.find(point => point.month === "2026-12")?.expense).toBe(100);
});

it("keeps the settled snapshot but includes a new purchase after early partial payment", () => {
  setScenario(
    [purchase("existing", 100), purchase("new", 200)],
    {
      "2026-10-29": {
        amount: 40, paid_at: "2026-10-05",
        items: [{
          id: "existing", name: "existing", date, value: 100,
          category_name: null, category_color: null, installment_label: null,
        }],
      },
    },
  );
  const invoice = localInvoice("card");
  expect(invoice.total).toBe(300);
  expect(invoice.paid_amount).toBe(40);
  expect(invoice.outstanding).toBe(260);
  expect(invoice.items.map(item => item.id).sort()).toEqual(["existing", "new"]);
  expect(localListCards()[0].current_invoice).toBe(260);
});

it("validates imported installment k/n and future settled dates before saving", () => {
  setScenario([]);
  const input: TransactionInput = {
    name: "Notebook", value: 1000, type: "despesa", status: "pago",
    date: "2026-10-20", account_id: "bank", card_id: "card",
    to_account_id: null, category_id: null, fixed: false, recurrence: null,
    installment: true, total_installments: 10, current_installment: 11,
    adjusted_value: null, attachment: null, notes: null, notify_enabled: true,
  };
  expect(() => localCreateTransaction(input)).toThrow("Parcela atual inválida.");
  expect(() => localCreateTransaction({ ...input, current_installment: 0 })).toThrow("Parcela atual inválida.");
  expect(() => localCreateTransaction({
    ...input, current_installment: 7, date: "2026-11-20",
  })).toThrow("Lançamento futuro não pode estar pago.");
  expect(localInvoice("card").items).toHaveLength(0);
});

it("records audit-safe partial invoice credit and reduces the available debt and limit", () => {
  setScenario([purchase("one", 300)]);
  const input = { cycle: "2026-10-29", purchase_id: "one", value: 50, reason: "Produto devolvido" };
  const after = localCreditInvoice("card", input, "credit-op-1");
  expect(after.total).toBe(250);
  expect(after.adjustment_total).toBe(50);
  expect(after.adjustments?.map(item => item.purchase_id)).toEqual(["one"]);
  expect(after.items).toHaveLength(1);
  expect(localListCards()[0].used).toBe(250);
  expect(localCreditInvoice("card", input, "credit-op-1").adjustments).toHaveLength(1);
  expect(() => localCreditInvoice("card", { ...input, value: 60 }, "credit-op-1"))
    .toThrow("Identificador reutilizado");
  expect(() => localDeleteTransaction("one")).toThrow("estorno auditado");
});

it("rejects overcrediting a purchase or the amount already paid", () => {
  setScenario(
    [purchase("one", 300)],
    { "2026-10-29": {
      amount: 240, paid_at: "2026-10-26",
      items: [{
        id: "one", name: "one", date, value: 300, category_name: null,
        category_color: null, installment_label: null,
      }],
    }},
  );
  const valid = { cycle: "2026-10-29", purchase_id: "one", value: 60, reason: "Desconto confirmado" };
  expect(() => localCreditInvoice("card", { ...valid, value: 61 }, "large"))
    .toThrow("saldo não pago");
  expect(localCreditInvoice("card", valid, "partial").paid).toBe(true);
  expect(() => localCreditInvoice("card", { ...valid, value: 1 }, "another"))
    .toThrow("saldo não pago");
  expect(localListCards()[0].used).toBe(0);
});

it("returns an old unpaid invoice as the local default and preserves explicit cycle views", () => {
  setScenario([{
    ...purchase("previous", 100), date: "2026-09-20",
  }]);
  expect(localInvoice("card").cycle_end).toBe("2026-09-29");
  expect(localInvoice("card").outstanding).toBe(100);
  expect(localInvoice("card", "2026-10-29").outstanding).toBe(0);
});


it("returns bank money after a fully paid bill without booking artificial income", () => {
  const purchaseRecord = { ...purchase("returned", 300), date: "2026-09-20", category_id: "food" };
  setScenario(
    [purchaseRecord],
    { "2026-09-29": {
      amount: 300, paid_at: "2026-10-07",
      items: [{
        id: "returned", name: "returned", date: "2026-09-20",
        value: 300, category_name: "Compras",
        category_color: null, installment_label: null,
      }],
    }},
  );
  const db = readDb();
  db.categories.push({
    id: "food", name: "Compras", icon: "shopping-bag",
    color: "#FF00FF", group: "desejos", monthly_budget: 500,
    monthly_goal: 0, created_at: "2026-01-01T00:00:00Z",
  });
  writeDb(db);
  expect(localInvoice("card", "2026-09-29").paid).toBe(true);
  const result = localBankRefund("card", {
    cycle: "2026-09-29", purchase_id: "returned", account_id: "bank",
    date: "2026-10-26", value: 100, reason: "Produto devolvido",
  }, "refund-1");
  expect(result.refund_total).toBe(100);
  expect(result.paid_amount).toBe(300);
  expect(result.outstanding).toBe(0);
  expect(localBankRefund("card", {
    cycle: "2026-09-29", purchase_id: "returned", account_id: "bank",
    date: "2026-10-26", value: 100, reason: "Produto devolvido",
  }, "refund-1").refunds).toHaveLength(1);
  expect(() => localBankRefund("card", {
    cycle: "2026-09-29", purchase_id: "returned", account_id: "bank",
    date: "2026-10-26", value: 101, reason: "Produto devolvido",
  }, "refund-1")).toThrow("Identificador");
  const home = localDashboard("2026-10");
  expect(home.income).toBe(0);
  expect(home.expense).toBe(-100);
  const calendar = localCalendar("2026-10");
  expect(calendar.income).toBe(0);
  expect(calendar.expense).toBe(-100);
  expect(calendar.net).toBe(100);
  expect(calendar.days.find(day => day.date === "2026-10-26")?.expense).toBe(-100);
  expect(calendar.days.find(day => day.date === "2026-10-26")?.income).toBe(0);
  expect(home.categories).toEqual([]); // refund-only month has no negative donut arcs
  expect(home.total_balance).toBe(5100);
  const budget = localBudget("2026-10");
  expect(budget.rows.find(row => row.category_id === "food")?.spent).toBe(-100);
  expect(localFlow({ month: "2026-10", months: 2 }).expense).toBe(-100);
  expect(localFinanceHistory(10).items.some(item => item.entity === "transactions")).toBe(true);
  expect(() => localDeleteTransaction("card:refund:refund-1")).toThrow();
});

it("prevents bank refund on a card bill that is not fully paid", () => {
  setScenario([purchase("new", 300)]);
  expect(() => localBankRefund("card", {
    cycle: "2026-10-29", purchase_id: "new", account_id: "bank",
    date: "2026-10-26", value: 50, reason: "Produto devolvido",
  }, "refund-2")).toThrow("fatura quitada");
});


it("keeps negative opening balance and card-free cash movement consistent locally", () => {
  const db = freshDb("Overdraft");
  db.accounts = [];
  db.cards = [];
  db.transactions = [];
  writeDb(db);
  const newAccount = localCreateAccount({
    name: "Conta com cheque especial", type: "corrente",
    institution: "Banco", institution_id: null,
    color: "#070F52", initial_balance: -500.23, active: true,
  });
  expect(localListAccounts().find(item => item.id === newAccount.id)?.balance).toBe(-500.23);
  expect(localDashboard("2026-10").total_balance).toBe(-500.23);
  const saved = readDb();
  expect(saved.accounts.find(item => item.id === newAccount.id)?.initial_balance).toBe(-500.23);
});


it("paginates the local monthly history with stable cursor parity and no duplicates", async () => {
  const transactions = Array.from({ length: 122 }, (_, i) => ({
    ...purchase(`purchase-${String(i).padStart(4, "0")}`, 1.25),
    card_id: null,
  }));
  setScenario(transactions);
  const first = await fetchTransactionsPage("2026-10", undefined, 50);
  const second = await fetchTransactionsPage("2026-10", first.next_cursor!, 50);
  const third = await fetchTransactionsPage("2026-10", second.next_cursor!, 50);
  expect([first.items.length, second.items.length, third.items.length]).toEqual([50, 50, 22]);
  expect(third.next_cursor).toBeNull();
  const ids = [...first.items, ...second.items, ...third.items].map(item => item.id);
  expect(new Set(ids).size).toBe(122);
  await expect(fetchTransactionsPage("invalid-month")).rejects.toThrow("Página financeira inválida.");
  await expect(fetchTransactionsPage("2026-10", "not-in-records")).rejects.toThrow("Cursor");
});


it("shows the next subscription charge on local calendar as forecast without a paid debit", () => {
  setScenario([]);
  const db = readDb();
  db.subscriptions = [{
    id: "stream", name: "Streaming", value: 49.9,
    category_id: null, category_name: null, category_color: null,
    account_id: "bank", account_name: "Banco", card_id: null,
    card_name: null, recurrence: "mensal", next_charge: "2026-10-29",
    active: true, notes: null,
  }];
  writeDb(db);
  let calendar = localCalendar("2026-10");
  expect(calendar.income).toBe(0);
  expect(calendar.expense).toBe(0);
  expect(calendar.projected_expense).toBe(49.9);
  expect(calendar.days.find(day => day.date === "2026-10-29")?.count).toBe(0);
  expect(localFlow({ month: "2026-10", months: 2 }).projected_expense).toBe(49.9);

  const updated = readDb();
  updated.transactions.push({
    ...purchase("stream-explicit", 49.9),
    name: "Streaming", status: "agendado", date: "2026-10-29",
    card_id: null,
  });
  writeDb(updated);
  calendar = localCalendar("2026-10");
  expect(calendar.projected_expense).toBe(49.9);
  expect(calendar.days.find(day => day.date === "2026-10-29")?.count).toBe(1);
  expect(localFlow({ month: "2026-10", months: 2 }).projected_expense).toBe(49.9);
});
