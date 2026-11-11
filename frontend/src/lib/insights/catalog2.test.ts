import { describe, expect, it } from "vitest";
import { READERS, type Ctx } from "@/lib/insights/catalog";
import { dailyPick } from "@/lib/insights/daily";
import type { Transaction } from "@/types/finnos";

const tx = (o: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), name: "X", value: 10, type: "despesa", status: "pago", date: "2026-11-05", account_id: "a", account_name: "Conta", card_id: null, card_name: null, to_account_id: null, to_account_name: null, category_id: "c", category_name: "Mercado", category_color: "#000", category_icon: null, fixed: false, recurrence: null, installment: false, total_installments: null, current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null, created_at: "", ...o });
const base: Ctx = { today: "2026-11-11", month: "2026-11", prevMonth: "2026-10", money: (v) => `R$ ${v.toFixed(2)}`, tx: [], prevTx: [], allTx: [], dashboard: null, prevDashboard: null, subs: null, cards: [], accounts: [], flow: null, prevHistory: null, history: null, budget: null, cycle: null, suggestion: null, categories: [] };

describe("segunda leva da biblioteca", () => {
  it("finds a charge repeated every month that is not marked as a subscription", () => {
    const allTx = ["2026-09-03", "2026-10-03", "2026-11-03"].map((date) => tx({ name: "Academia Smart", value: 99.9, date }));
    const r = READERS["recorrentes-escondidos"].read({ ...base, allTx });
    expect(r.value).toBe("1");
    expect(r.rows?.[0].label).toBe("Academia Smart");
  });
  it("flags a fixed bill charged more than last time", () => {
    const allTx = [tx({ name: "Internet", value: 99, date: "2026-10-10", fixed: true }), tx({ name: "Internet", value: 119, date: "2026-11-10", fixed: true })];
    const r = READERS["aumentos-de-preco"].read({ ...base, allTx });
    expect(r.rows?.[0].value).toBe("+R$ 20.00");
  });
  it("adds interest, fees and annual fees of the last 12 months", () => {
    const allTx = [tx({ name: "Anuidade cartão", value: 30 }), tx({ name: "IOF", value: 4.5 }), tx({ name: "Padaria", value: 12 }), tx({ name: "Aluguel", value: 1000, category_name: "Moradia" })];
    expect(READERS["juros-e-tarifas"].read({ ...base, allTx }).value).toBe("R$ 34.50");
  });
  it("Meu orçamento suggests a budget when there is none", () => {
    const suggestion = { expected_income: 5000, method: "media_recente" as const, writes_data: false as const, categories: [{ category_id: "m", name: "Mercado", group: "necessidades" as const, average: 800, suggested: 750, months_observed: 3 }] };
    const r = READERS["meu-orcamento"].read({ ...base, suggestion });
    expect(r.tile).toBe("Orçamento sugerido");
    expect(r.value).toBe("R$ 750.00");
  });
  it("Análise do dia never repeats what is on the boards and stays the same through the day", () => {
    const ctx = { ...base, tx: [tx({ name: "Luz", value: 200, status: "pendente", date: "2026-11-03" }), tx({ name: "Mercado", value: 300 })] };
    const first = dailyPick(ctx, ["em-aberto"], "2026-11-11");
    expect(first).not.toBe("em-aberto");
    expect(dailyPick(ctx, ["em-aberto"], "2026-11-11")).toBe(first);
  });
});
