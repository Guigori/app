import { afterEach, expect, test, vi } from "vitest";
import { enableLocalMode } from "@/lib/mode";
import { freshDb, writeDb } from "@/lib/local/store";
import {
  localCalendar, localCreateAccount, localCreateCategory, localCreateSubscription, localCreateTransaction,
} from "@/lib/local/engine";
import type { TransactionInput } from "@/types/finnos";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function setup() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 10, 12));
  enableLocalMode();
  writeDb(freshDb());
  const account = localCreateAccount({
    name: "Conta teste", institution: "Banco teste",
    type: "corrente", color: "#070F52", initial_balance: 1000, active: true,
  });
  const category = (name: string) => localCreateCategory({ name, icon: "tag", color: "#4B2CFF", group: "desejos", monthly_budget: 0, monthly_goal: 0 });
  return { account, subs: category("Assinaturas"), food: category("Alimentação"), streaming: category("Streaming") };
}

const tx = (over: Partial<TransactionInput>): TransactionInput => ({
  name: "Compra", value: 10, type: "despesa", status: "pago", date: "2026-10-05", account_id: "", card_id: null,
  to_account_id: null, category_id: null, fixed: false, recurrence: null, installment: false, total_installments: null,
  current_installment: null, adjusted_value: null, attachment: null, notes: null, ...over,
});

test("the calendar follows the category filter and lists planned subscriptions by day", () => {
  const { account, subs, food, streaming } = setup();
  localCreateTransaction(tx({ name: "Mercado", value: 300, account_id: account.id, category_id: food.id }));
  localCreateTransaction(tx({ name: "Academia", value: 99, status: "agendado", date: "2026-10-20", account_id: account.id, category_id: subs.id }));
  localCreateSubscription({ name: "Netflix", value: 49.9, recurrence: "mensal", next_charge: "2026-10-29", account_id: account.id, category_id: streaming.id, card_id: null, active: true, notes: null });

  const every = localCalendar("2026-10");
  expect(every.planned?.map((p) => [p.date, p.name])).toEqual([["2026-10-29", "Netflix"]]);
  expect(every.expense).toBe(300);

  // "Assinaturas" keeps every registered plan, even one saved under another category.
  const onlySubs = localCalendar("2026-10", subs.id);
  expect(onlySubs.days.map((d) => d.date)).toEqual(["2026-10-20", "2026-10-29"]);
  expect(onlySubs.expense).toBe(0);
  expect(onlySubs.projected_expense).toBe(148.9);

  const onlyFood = localCalendar("2026-10", food.id);
  expect(onlyFood.days.map((d) => d.date)).toEqual(["2026-10-05"]);
  expect(onlyFood.planned).toEqual([]);
});
