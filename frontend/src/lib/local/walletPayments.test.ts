import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("@/lib/mode", () => ({ getMode: () => "local", isLocalMode: () => true }));

import { freshDb, readDb, writeDb } from "@/lib/local/store";
import { localCreateTransaction, localInvoice, localListAccounts, localListCards, localPayInvoice, localUndoInvoicePayment } from "@/lib/local/engine";
import { FundsError } from "@/lib/funds";
import type { Transaction, TransactionInput } from "@/types/finnos";

// Same approved effects as finnos/tests/test_wallet_payments.py (12/11/2026).
function scenario(balance = 1000, overdraft: number | null = null): void {
  const db = freshDb("Test");
  db.cards = [{
    id: "card", name: "Nubank", closing_day: 29, due_day: 7, limit: 2000,
    payment_account_id: null, institution: "Nubank", institution_id: null,
    color: "#820AD1", active: true, created_at: "2026-01-01T00:00:00Z",
  }];
  db.accounts = [{
    id: "bank", name: "Itaú", initial_balance: balance, overdraft_limit: overdraft,
    institution: "Itaú", type: "corrente", color: "#EC7000", active: true,
    created_at: "2026-01-01T00:00:00Z", balance, total_income: 0, total_expense: 0,
  }, {
    id: "other", name: "Inter", initial_balance: 0, institution: "Inter", type: "corrente", color: "#FF7A00",
    active: true, created_at: "2026-01-02T00:00:00Z", balance: 0, total_income: 0, total_expense: 0,
  }];
  db.transactions = [{
    id: "p1", name: "Mercado", type: "despesa", status: "pago", date: "2026-10-10", value: 100,
    account_id: "bank", card_id: "card", category_id: null, installment: false,
    created_at: "2026-10-10T12:00:00Z",
  } as Transaction];
  writeDb(db);
}

const pay = (value: number, allow = false, date = "2026-11-05", cycle = "2026-10-29") =>
  localPayInvoice("card", { cycle, account_id: "bank", date, value, allow_overdraft: allow });

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T14:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("partial payment of a closed invoice carries the rest to the next one", () => {
  scenario();
  const paid = pay(40);
  expect([paid.paid_amount, paid.carried_amount, paid.outstanding, paid.carried_to]).toEqual([40, 60, 0, "2026-11-29"]);
  const next = localInvoice("card", "2026-11-29");
  expect(next.total).toBe(60);
  expect(next.items.find(i => i.carry_from === "2026-10-29")?.name).toBe("Saldo da fatura anterior");
  expect(localListCards().find(c => c.id === "card")?.used).toBe(60);
});

it("partial payment before the closing is an advance", () => {
  scenario();
  vi.setSystemTime(new Date("2026-10-20T14:00:00Z"));
  const paid = pay(40, false, "2026-10-20");
  expect([paid.carried_amount, paid.outstanding]).toEqual([0, 60]);
});

it("refuses without funds and asks before using the cheque especial", () => {
  scenario(30);
  expect(() => pay(40)).toThrow(FundsError);
  scenario(30, 50);
  try { pay(40); throw new Error("should ask"); } catch (error) {
    expect((error as FundsError).code).toBe("confirmar_cheque_especial");
    expect((error as FundsError).message).toContain("10,00");
  }
  expect(pay(40, true).paid_amount).toBe(40);
  expect(localListAccounts().find(a => a.id === "bank")?.balance).toBe(-10);
  scenario(30, 5);
  expect(() => pay(40, true)).toThrow(/Saldo insuficiente/);
});

it("undoing the last payment adds a linked reversal and removes the carry", () => {
  scenario();
  const paid = pay(40);
  const undone = localUndoInvoicePayment("card", paid.last_payment_id!);
  expect([undone.paid_amount, undone.carried_amount, undone.outstanding]).toEqual([0, 0, 100]);
  const reversal = readDb().transactions.find(t => t.invoice_reversal_of === paid.last_payment_id);
  expect(reversal?.type).toBe("receita");
  expect(readDb().transactions.some(t => t.id === paid.last_payment_id)).toBe(true);
  expect(localInvoice("card", "2026-11-29").items).toHaveLength(0);
  expect(localListAccounts().find(a => a.id === "bank")?.balance).toBe(1000);
  expect(() => localUndoInvoicePayment("card", paid.last_payment_id!)).toThrow();
});

it("only the last payment, and not after the next invoice was paid", () => {
  scenario();
  vi.setSystemTime(new Date("2026-10-20T14:00:00Z"));
  const first = pay(30, false, "2026-10-20");
  pay(20, false, "2026-10-20");
  expect(() => localUndoInvoicePayment("card", first.last_payment_id!)).toThrow(/último pagamento/);

  scenario();
  vi.setSystemTime(new Date("2026-11-12T14:00:00Z"));
  const carried = pay(40);
  pay(10, false, "2026-11-06", "2026-11-29");
  expect(() => localUndoInvoicePayment("card", carried.last_payment_id!)).toThrow(/fatura seguinte/);
});

it("a paid transfer cannot overdraw the source", () => {
  scenario(100);
  const transfer: TransactionInput = {
    name: "Reserva", value: 150, type: "transferencia", status: "pago", date: "2026-11-12", account_id: "bank",
    card_id: null, to_account_id: "other", category_id: null, fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null, adjusted_value: null, attachment: null, notes: null,
  };
  expect(() => localCreateTransaction(transfer)).toThrow(/Saldo insuficiente/);
  expect(localCreateTransaction({ ...transfer, value: 100 }).value).toBe(100);
  expect(localCreateTransaction({ ...transfer, status: "agendado", date: "2026-12-01" }).status).toBe("agendado");
});

it("undoing a transfer adds an inverse linked both ways and freezes both", async () => {
  const { localReverseTransfer, localUpdateTransaction, localNotifications } = await import("@/lib/local/engine");
  scenario(500);
  const transfer: TransactionInput = {
    name: "Reserva", value: 200, type: "transferencia", status: "pago", date: "2026-11-01", account_id: "bank",
    card_id: null, to_account_id: "other", category_id: null, fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null, adjusted_value: null, attachment: null, notes: null,
  };
  const original = localCreateTransaction(transfer);
  const inverse = localReverseTransfer(original.id);
  expect([inverse.account_id, inverse.to_account_id, inverse.reversal_of]).toEqual(["other", "bank", original.id]);
  expect(readDb().transactions.find(t => t.id === original.id)?.reversed_by).toBe(inverse.id);
  expect(localListAccounts().find(a => a.id === "bank")?.balance).toBe(500);
  expect(() => localReverseTransfer(original.id)).toThrow(/já foi desfeita/);
  expect(() => localUpdateTransaction(original.id, { ...transfer, name: "x" })).toThrow(/desfeita/);
  // Reminder shows the owed invoice and links straight to it.
  vi.setSystemTime(new Date("2026-11-03T14:00:00Z"));
  const reminder = localNotifications(7).items.find(i => i.kind === "fatura" && i.date === "2026-11-07");
  expect(reminder?.value).toBe(100);
  expect(reminder?.target_url).toBe("/cartoes/card?cycle=2026-10-29");
});
