import { afterEach, expect, test, vi } from "vitest";
import { enableLocalMode } from "@/lib/mode";
import { freshDb, writeDb } from "@/lib/local/store";
import { localCreateAccount, localCreateCategory, localCreateTransaction } from "@/lib/local/engine";
import { localRadar } from "@/lib/local/radar";
import { radarTarget } from "@/lib/radarUi";
import type { RadarSignal } from "@/types/finnos";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test("a category over its limit is told in reais, with the excess as impact", () => {
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
  const account = localCreateAccount({ name: "Conta", institution: "Banco", type: "corrente", color: "#070F52", initial_balance: 0, active: true });
  const shop = localCreateCategory({ name: "Compras", icon: "tag", color: "#4B2CFF", group: "desejos", monthly_budget: 300, monthly_goal: 0 });
  localCreateTransaction({ name: "Loja", value: 800, type: "despesa", status: "pago", date: "2026-11-03", account_id: account.id, card_id: null,
    to_account_id: null, category_id: shop.id, fixed: false, recurrence: null, installment: false, total_installments: null,
    current_installment: null, adjusted_value: null, attachment: null, notes: null });

  const alert = localRadar().items.find((s) => s.id.startsWith("budget-"));
  expect(alert).toMatchObject({ title: "Compras passou do limite", impact: 500, severity: "critical" });
  expect(alert?.metric?.replace(/\s/g, " ")).toBe("R$ 500,00 acima");
  expect(alert?.description).toContain("gastos de");
  expect(radarTarget(alert!)).toEqual({ to: `/transacoes?aba=caixa&month=2026-11&metric=despesas&category_id=${shop.id}`, label: "Ver no Caixa", short: "Ver gastos" });
});

test("a cash-flow signal leads to the projection", () => {
  const pace = { id: "safe-spend-2026-11", related_entity_type: "cashflow" } as RadarSignal;
  expect(radarTarget(pace).short).toBe("Ver projeção");
});
