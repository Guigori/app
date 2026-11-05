import { afterEach, expect, test, vi } from "vitest";
import { enableLocalMode } from "@/lib/mode";
import { freshDb, writeDb } from "@/lib/local/store";
import { localCreateAccount, localCreateSubscription, localCreateTransaction, localFlow } from "@/lib/local/engine";
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
  vi.setSystemTime(new Date(2026, 10, 5, 12));
  enableLocalMode();
  writeDb(freshDb());
  const account = (name: string) => localCreateAccount({ name, institution: "Banco", type: "corrente", color: "#070F52", initial_balance: 0, active: true });
  return { bank: account("Conta"), other: account("Outra") };
}

const tx = (over: Partial<TransactionInput>): TransactionInput => ({
  name: "Compra", value: 100, type: "despesa", status: "pago", date: "2026-11-02", account_id: "", card_id: null,
  to_account_id: null, category_id: null, fixed: false, recurrence: null, installment: false, total_installments: null,
  current_installment: null, adjusted_value: null, attachment: null, notes: null, ...over,
});

test("the cash flow lists what is still expected and can follow one account", () => {
  const { bank, other } = setup();
  localCreateTransaction(tx({ name: "Mercado", value: 300, account_id: bank.id }));
  localCreateTransaction(tx({ name: "Aluguel", value: 1400, fixed: true, recurrence: "mensal", date: "2026-10-10", account_id: bank.id }));
  localCreateTransaction(tx({ name: "Luz", value: 180, status: "agendado", date: "2026-11-20", account_id: bank.id }));
  localCreateTransaction(tx({ name: "Salário", type: "receita", value: 5000, status: "agendado", date: "2026-11-05", account_id: other.id }));
  localCreateSubscription({ name: "Spotify", value: 21.9, recurrence: "mensal", next_charge: "2026-11-28", account_id: bank.id, category_id: null, card_id: null, active: true, notes: null });

  const flow = localFlow({ month: "2026-11", months: 2 });
  const upcoming = flow.upcoming ?? [];
  expect(upcoming.map((u) => [u.name, u.kind])).toEqual(expect.arrayContaining([["Aluguel", "fixa"], ["Luz", "agendado"], ["Spotify", "assinatura"], ["Salário", "agendado"]]));
  const sum = (type: string) => Math.round(upcoming.filter((u) => u.type === type).reduce((s, u) => s + u.value, 0) * 100) / 100;
  expect(sum("despesa")).toBe(flow.projected_expense);
  expect(sum("receita")).toBe(flow.projected_income);

  const onlyOther = localFlow({ month: "2026-11", months: 2, account_id: other.id });
  expect(onlyOther.upcoming?.map((u) => u.name)).toEqual(["Salário"]);
  expect(onlyOther.expense).toBe(0);
});
