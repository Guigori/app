import { afterEach, expect, test, vi } from "vitest";
import { enableLocalMode } from "@/lib/mode";
import { freshDb, writeDb } from "@/lib/local/store";
import { todayISO } from "@/lib/format";
import {
  localCalendar, localCreateAccount, localCreateCard, localCreateTransaction,
  localDeleteAccount, localCreateInstitution, localListInstitutions,
  localDashboard, localDeleteCard, localInvoice, localListAccounts, localListCards,
  localPayInvoice,
} from "@/lib/local/engine";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  enableLocalMode();
  writeDb(freshDb());
  const account = localCreateAccount({
    name: "Conta teste", institution: "Banco teste",
    type: "corrente", color: "#070F52", initial_balance: 1000, active: true,
  });
  const card = localCreateCard({
    name: "Cartão teste", institution: "Banco teste", color: "#4B2CFF",
    limit: 1000, closing_day: 31, due_day: 7,
    payment_account_id: account.id, active: true,
  });
  return { account, card };
}

test("credit purchase impacts the card, but the account only on invoice settlement", () => {
  const { account, card } = setup();
  const day = todayISO();
  localCreateTransaction({
    name: "Compra no crédito", value: 100, type: "despesa", status: "pago",
    date: day, account_id: account.id, card_id: card.id, to_account_id: null,
    category_id: null, fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null,
    adjusted_value: null, attachment: null, notes: null,
  });
  expect(localListAccounts()[0].balance).toBe(1000);
  expect(localListCards()[0].used).toBe(100);
  expect(localInvoice(card.id).outstanding).toBe(100);
  expect(localDashboard(day.slice(0, 7)).expense).toBe(100);

  localPayInvoice(card.id, { account_id: account.id, date: day, value: 40 });
  expect(localListAccounts()[0].balance).toBe(960);
  expect(localInvoice(card.id).outstanding).toBe(60);
  expect(localListCards()[0].used).toBe(60);
  expect(localDashboard(day.slice(0, 7)).expense).toBe(100);
  expect(localCalendar(day.slice(0, 7)).expense).toBe(100);

  localPayInvoice(card.id, { account_id: account.id, date: day, value: 60 });
  expect(localInvoice(card.id).outstanding).toBe(0);
  expect(localInvoice(card.id).paid).toBe(true);
  expect(localListAccounts()[0].balance).toBe(900);
  expect(localListCards()[0].used).toBe(0);
  expect(() => localPayInvoice(card.id, { account_id: account.id, date: day, value: 1 })).toThrow();
  expect(() => localDeleteCard(card.id)).toThrow();
});

test("invalid new sub-cent installment schedules never enter local history", () => {
  const { account, card } = setup();
  expect(() => localCreateTransaction({
    name: "Compra minúscula", value: 0.01, type: "despesa", status: "pago",
    date: todayISO(), account_id: account.id, card_id: card.id,
    to_account_id: null, category_id: null, fixed: false, recurrence: null,
    installment: true, total_installments: 12, current_installment: 1,
    adjusted_value: null, attachment: null, notes: null,
  })).toThrow(/R\$ 0,01/);
  expect(localListCards()[0].used).toBe(0);
});


test("local wallet refuses account deletion with only a linked credit card", () => {
  const { account } = setup();
  expect(() => localDeleteAccount(account.id)).toThrow(/cartão de crédito/);
});

test("local institutions are isolated records and cannot be deleted while used", () => {
  setup();
  const bank = localCreateInstitution({ name: "Banco Próprio", color: "#5B35FF" });
  expect(localListInstitutions().map(item => item.id)).toContain(bank.id);
  const checking = localCreateAccount({
    name: "Conta do banco", institution: bank.name, institution_id: bank.id,
    type: "corrente", color: "#070F52", initial_balance: 50, active: true,
  });
  expect(checking.institution_id).toBe(bank.id);
  expect(() => localCreateInstitution({ name: "banco próprio", color: "#5B35FF" })).toThrow(/já cadastrada/);
});
