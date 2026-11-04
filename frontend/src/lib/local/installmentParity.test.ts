import { afterEach, beforeEach, expect, it, vi } from "vitest";
import parity from "../../../fixtures/finance-installment-schedule-parity.json";
import { freshDb, writeDb } from "./store";
import { installmentSchedule, localCalendar, localListAccounts } from "./engine";
import type { Account, Transaction } from "@/types/finnos";

// AUD-04: same fixture as finnos/tests/test_installment_schedule_parity.py.
vi.mock("@/lib/mode", () => ({ getMode: () => "local", isLocalMode: () => true }));

beforeEach(() => {
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

type Case = (typeof parity.cases)[number] & {
  paid_month_cents?: Record<string, number | null>;
  unpaid_month_cents?: Record<string, number | null>;
};
const cents = (value: number) => Math.round(value * 100);

function load(tx: Case["tx"]) {
  const db = freshDb("Installment parity");
  db.accounts = [{
    ...parity.account, name: "Banco", institution: "Test", institution_id: null, type: "corrente",
    color: "#070F52", active: true, created_at: "2026-01-01T00:00:00Z",
    balance: parity.account.initial_balance, total_income: 0, total_expense: 0,
  }] as Account[];
  db.cards = tx.card_id ? [{ id: tx.card_id, name: "Cartao", closing_day: 29, due_day: 7, limit: 5000, active: true } as never] : [];
  db.transactions = [{ ...tx, category_id: null, fixed: false, recurrence: null, created_at: "2026-01-01T00:00:00Z" }] as Transaction[];
  writeDb(db);
}

for (const c of parity.cases as Case[]) {
  it(`${c.id}: schedule, realized balance and monthly amounts match the API`, () => {
    expect(installmentSchedule(c.tx)).toEqual(c.schedule);
    for (const [today, expected] of Object.entries(c.realized_cents)) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${today}T12:00:00`));
      load(c.tx);
      const bank = localListAccounts().find((a) => a.id === "bank")!;
      expect(cents(bank.balance - parity.account.initial_balance), `${c.id} @ ${today}`).toBe(expected);
    }
    for (const [month, expected] of Object.entries(c.paid_month_cents ?? {})) {
      load(c.tx);
      const spent = localCalendar(month).days.reduce((total, day) => total + day.expense, 0);
      expect(cents(spent), `${c.id} paid ${month}`).toBe(expected ?? 0);
    }
    for (const [month, expected] of Object.entries(c.unpaid_month_cents ?? {})) {
      load(c.tx);
      const projected = localCalendar(month).days.reduce((total, day) => total + day.projected_expense, 0);
      expect(cents(projected), `${c.id} projected ${month}`).toBe(expected ?? 0);
    }
  });
}
