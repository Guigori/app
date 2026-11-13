import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("@/lib/mode", () => ({ getMode: () => "local", isLocalMode: () => true }));

import { freshDb, writeDb, readDb } from "@/lib/local/store";
import { localCreateAccount, localCreateTransaction, localListAccounts, localRechargeBenefits, localUpdateAccount } from "@/lib/local/engine";
import { BenefitFundsError, dueRecharges, normalizeWallets, rechargeDate } from "@/lib/benefits";
import type { AccountInput, BenefitWalletInput, TransactionInput } from "@/types/finnos";

// Same rules as finnos/tests/test_benefits.py (etapa 5).
const NAMES = ["Refeição", "Alimentação", "Mobilidade", "Cultura", "Saúde", "Educação", "Home office", "Combustível"];
const DAYS = [1, 5, 10, 15, 20, 25, 28, 31];
const wallets = (): BenefitWalletInput[] => NAMES.map((name, i) => ({
  name, monthly_amount: 100 * (i + 1), day: DAYS[i], initial_balance: 0, allow_negative: false, is_default: i === 0,
}));
const card = (w = wallets()): AccountInput => ({
  name: "Caju", institution: "", institution_id: null, type: "beneficio", color: "#FF5A00", initial_balance: 0, active: true, wallets: w,
});
const spend = (accountId: string, value: number, walletId?: string): TransactionInput => ({
  name: "Almoço", value, type: "despesa", status: "pago", date: "2026-11-12", account_id: accountId, card_id: null,
  to_account_id: null, category_id: null, fixed: false, recurrence: null, installment: false, total_installments: null,
  current_installment: null, adjusted_value: null, attachment: null, notes: null, wallet_id: walletId ?? null,
});

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
  writeDb(freshDb("Test"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function createdIn(start: string) {
  vi.setSystemTime(new Date(`${start}T14:00:00Z`));
  const account = localCreateAccount(card());
  vi.setSystemTime(new Date("2026-11-12T14:00:00Z"));
  return account;
}

it("up to eight benefits, unique names, one default", () => {
  expect(normalizeWallets(wallets(), [], "2026-11-12")).toHaveLength(8);
  expect(() => normalizeWallets([...wallets(), { ...wallets()[0], name: "Nona" }], [], "2026-11-12")).toThrow(/no máximo 8/);
  expect(() => normalizeWallets([wallets()[0], { ...wallets()[1], name: "refeicao" }], [], "2026-11-12")).toThrow(/Já existe/);
  const fixed = normalizeWallets(wallets().map((w) => ({ ...w, is_default: false })), [], "2026-11-12");
  expect(fixed.filter((w) => w.is_default).map((w) => w.name)).toEqual(["Refeição"]);
});

it("day 31 falls on the last day of short months", () => {
  expect(rechargeDate({ day: 31 }, 2026, 2)).toBe("2026-02-28");
  expect(rechargeDate({ day: 31 }, 2026, 11)).toBe("2026-11-30");
});

it("a simulated month recharges each of the eight benefits once on its day", () => {
  const account = createdIn("2026-10-01");
  for (let day = 1; day <= 30; day++) {
    vi.setSystemTime(new Date(`2026-11-${String(day).padStart(2, "0")}T14:00:00Z`));
    localRechargeBenefits();
    localRechargeBenefits(); // twice the same day: nothing new
  }
  const recharges = readDb().transactions.filter((t) => t.benefit_recharge && t.date.startsWith("2026-11"));
  expect(recharges).toHaveLength(8);
  expect(new Set(recharges.map((t) => t.id)).size).toBe(8);
  expect(recharges.find((t) => t.name === "Recarga Combustível")?.date).toBe("2026-11-30");
  vi.setSystemTime(new Date("2026-11-30T14:00:00Z"));
  const view = localListAccounts().find((a) => a.id === account.id)!;
  // October and November both stay: unused balance never expires.
  expect(view.wallets?.find((w) => w.name === "Refeição")?.balance).toBe(200);
  expect(view.balance).toBe(2 * (100 + 200 + 300 + 400 + 500 + 600 + 700 + 800));
});

it("nothing is back-filled before the benefit existed", () => {
  const account = createdIn("2026-11-12");
  const due = dueRecharges({ wallets: readDb().accounts.find((a) => a.id === account.id)!.wallets as never }, "2026-11-12");
  expect(due).toHaveLength(0);
});

it("the default benefit pays when none is chosen; another one can be picked", () => {
  const account = createdIn("2026-10-01");
  localRechargeBenefits();
  const ids = Object.fromEntries((localListAccounts().find((a) => a.id === account.id)!.wallets ?? []).map((w) => [w.name, w.id]));
  expect(localCreateTransaction(spend(account.id, 150)).wallet_id).toBe(ids["Refeição"]);
  localCreateTransaction(spend(account.id, 300, ids["Alimentação"]));
  const view = localListAccounts().find((a) => a.id === account.id)!;
  expect(view.wallets?.find((w) => w.name === "Refeição")?.balance).toBe(50);
  expect(view.wallets?.find((w) => w.name === "Alimentação")?.balance).toBe(100);
});

it("a benefit without enough balance refuses the purchase unless it may go negative", () => {
  const account = createdIn("2026-10-01");
  localRechargeBenefits();
  expect(() => localCreateTransaction(spend(account.id, 250))).toThrow(BenefitFundsError);
  const edited = wallets().map((w, i) => ({ ...w, id: readDb().accounts[0].wallets![i].id, allow_negative: i === 0 }));
  localUpdateAccount(account.id, card(edited));
  expect(localCreateTransaction(spend(account.id, 250)).value).toBe(250);
});

it("a benefit with history cannot be removed", () => {
  const account = createdIn("2026-10-01");
  localRechargeBenefits();
  const stored = readDb().accounts[0].wallets!;
  const withoutFirst = wallets().slice(1).map((w, i) => ({ ...w, id: stored[i + 1].id }));
  expect(() => localUpdateAccount(account.id, card(withoutFirst))).toThrow(/não pode ser removido/);
});

it("moving between two benefits of the same card keeps the card total", () => {
  const account = createdIn("2026-10-01");
  localRechargeBenefits();
  const before = localListAccounts().find((a) => a.id === account.id)!;
  const ids = Object.fromEntries((before.wallets ?? []).map((w) => [w.name, w.id]));
  localCreateTransaction({ ...spend(account.id, 150, ids["Mobilidade"]), type: "transferencia", name: "Mover",
    to_account_id: account.id, to_wallet_id: ids["Refeição"] });
  const after = localListAccounts().find((a) => a.id === account.id)!;
  expect(after.balance).toBe(before.balance);
  expect(after.wallets?.find((w) => w.name === "Refeição")?.balance).toBe(350);
  expect(after.wallets?.find((w) => w.name === "Mobilidade")?.balance).toBe(450);
});
