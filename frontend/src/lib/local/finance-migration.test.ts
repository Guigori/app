import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("@/lib/mode", () => ({ getMode: () => "local" }));

import { freshDb, writeDb, type LocalCard } from "@/lib/local/store";
import { localInvoice, localListCards, localFlow, localCreateTransaction } from "@/lib/local/engine";
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
