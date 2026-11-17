import { describe, expect, it } from "vitest";
import { divergences, monthOutlook, reviewBills, reviewGoals, reviewInstallments, reviewSubscriptions, savingIdeas, suggestReminders } from "@/lib/budget/review";
import type { SubscriptionItem, Transaction } from "@/types/finnos";

const tx = (p: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), name: "x", value: 10, type: "despesa", status: "pago", date: "2026-10-10", account_id: "a", category_id: "c", fixed: false, installment: false, ...p } as Transaction);

describe("Fechar o mês · conferência", () => {
  it("lists the bills, what was paid, what is open and what changed from last month", () => {
    const now = [tx({ name: "Aluguel", value: 1450, fixed: true, date: "2026-10-05" }), tx({ name: "Internet", value: 120, fixed: true, date: "2026-10-10" }), tx({ name: "Farmácia", value: 68, status: "pendente", date: "2026-10-08" }), tx({ name: "Café", value: 9 })];
    const before = [tx({ name: "Aluguel", value: 1400, fixed: true, date: "2026-09-05" }), tx({ name: "Internet", value: 120, fixed: true, date: "2026-09-10" })];
    const r = reviewBills("2026-10", now, before, "despesa");
    expect(r.lines.map((l) => l.tx.name)).toEqual(["Farmácia", "Aluguel", "Internet"]);
    expect(r.open).toHaveLength(1);
    expect(r.changed.map((l) => [l.tx.name, l.delta])).toEqual([["Aluguel", 50]]);
    expect(divergences("2026-10", now, before, []).priceUps.map((l) => l.tx.name)).toEqual(["Aluguel"]);
  });
  it("tells how many installments are left and when the last one comes", () => {
    const i = reviewInstallments("2026-10", [tx({ name: "Notebook (4/10)", installment: true, installment_value: 250, value: 2500, current_installment: 4, total_installments: 10, card_id: "nu", card_name: "Nubank" }), tx({ name: "Tênis (4/4)", installment: true, installment_value: 80, value: 320, current_installment: 4, total_installments: 4, card_id: "nu" })]);
    expect(i.lines[0]).toMatchObject({ name: "Notebook", left: 6, remaining: 1500, ends: "2027-04" });
    expect(i.ending.map((l) => l.name)).toEqual(["Tênis"]);
    expect(i.future).toBe(1500);
  });
  it("gives the last day to cancel a subscription", () => {
    const s = reviewSubscriptions([{ id: "s", name: "Streaming", value: 55, active: true, next_charge: "2026-12-20", recurrence: "mensal", account_name: "Nu", card_name: null } as SubscriptionItem], "2026-11-16");
    expect(s.lines[0]).toMatchObject({ cancelBy: "2026-12-19", yearly: 660 });
  });
  it("compares what the plan set aside with what was saved", () => {
    const g = reviewGoals("2026-10", [{ id: "v", name: "Viagem", target: 5000, saved: 1200, deposits: [{ date: "2026-10-03", value: 300 }] } as never], { v: 500 });
    expect(g[0]).toMatchObject({ planned: 500, saved: 300, diff: -200 });
  });
  it("finds likely duplicates", () => {
    const d = divergences("2026-10", [tx({ name: "Uber", value: 23.5, date: "2026-10-03" }), tx({ name: "Uber", value: 23.5, date: "2026-10-04" })], [], []);
    expect(d.dups).toHaveLength(1);
  });
});

describe("Começar o mês", () => {
  it("shows what is left if the month follows the budget", () => {
    expect(monthOutlook({ startBalance: 1000, inTotal: 5000, billTotal: 2000, limitsTotal: 2200, saveTotal: 500 })).toMatchObject({ leftover: 300, endBalance: 1800, tone: "positivo" });
    expect(monthOutlook({ startBalance: 0, inTotal: 3000, billTotal: 2000, limitsTotal: 1200, saveTotal: 0 }).tone).toBe("negativo");
  });
  it("suggests reminders and ideas to save, without creating anything", () => {
    const r = suggestReminders([{ key: "k", name: "Aluguel", date: "2026-12-05", value: 1450, type: "despesa", on: true, origin: "fluxo" }, { key: "s", name: "Salário", date: "2026-12-05", value: 3000, type: "receita", on: true, origin: "fluxo" }], [], [{ id: "pagar:k", date: "2026-12-03", text: "", kind: "conta" }]);
    expect(r.map((x) => x.id)).toEqual(["conferir:s"]);
    const ideas = savingIdeas([[{ category_id: "m", name: "Mercado", spent: 400, limit: 700 }, { category_id: "r", name: "Restaurantes", spent: 400, limit: 250 }], [{ category_id: "m", name: "Mercado", spent: 420, limit: 700 }, { category_id: "r", name: "Restaurantes", spent: 380, limit: 250 }]]);
    expect(ideas.map((i) => [i.name, i.kind, i.to])).toEqual([["Mercado", "baixar", 430], ["Restaurantes", "subir", 390]]);
  });
});

describe("Fechar o mês · contra o previsto", () => {
  it("says when an income came lower or a bill higher than planned", async () => {
    const inc = reviewBills("2026-10", [tx({ id: "f", name: "Freela", type: "receita", value: 400, date: "2026-10-25" })], [], "receita", { "tx:f": 900 });
    expect(inc.paid[0]).toMatchObject({ planned: 900, vsPlanned: -500 });
    expect(inc.changed).toHaveLength(1);
    const { dueReminders } = await import("@/lib/budget/homeInsights");
    const r = [{ id: "a", date: "2026-11-17", text: "Pagar aluguel" }, { id: "b", date: "2026-11-25", text: "Freela" }, { id: "c", date: "2026-11-15", text: "Feito", done: true }];
    expect(dueReminders(r, "2026-11-16").map((x) => x.id)).toEqual(["a"]);
  });
});
