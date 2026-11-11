import { describe, expect, it } from "vitest";
import { widgetAlerts } from "@/lib/insights/alerts";
import type { NextInvoice } from "@/lib/insights/upcoming";

const inv = (over: Partial<NextInvoice>): NextInvoice => ({ cardId: "c6", cardName: "C6", color: "#000", amount: 900, due: "2026-11-15", closed: true, days: 5, accountId: "a", accountName: "Conta", balanceBefore: 300, covers: false, shortfall: 600, ...over });

describe("widgetAlerts", () => {
  it("warns about an invoice the account cannot pay and opens its page filtered by the card", () => {
    const [a] = widgetAlerts({ invoices: [inv({})], today: "2026-11-10" });
    expect(a.id).toBe("fatura-sem-saldo:c6:2026-11-15");
    expect(a.target).toBe("/analise/painel/fatura-que-vem?cartao=c6");
    expect(a.critical).toBe(true);
  });
  it("ignores covered or far invoices, and flags overdue ones", () => {
    expect(widgetAlerts({ invoices: [inv({ covers: true }), inv({ days: 20 })], today: "2026-11-10" })).toHaveLength(0);
    expect(widgetAlerts({ invoices: [inv({ days: -2, covers: true })], today: "2026-11-10" })[0].id).toMatch(/^fatura-atrasada/);
  });
  it("warns when the balance estimate turns negative and when the budget is over", () => {
    const forecast = { today: 100, end: -50, change: -150, incoming: 0, outgoing: 150, lowest: { date: "2026-11-20", value: -80, kind: "previsto" as const }, firstNegative: "2026-11-18", series: [], events: [] };
    const list = widgetAlerts({ forecast, budget: { month: "2026-11", planned: 1000, spent: 1200 }, today: "2026-11-10" });
    expect(list.map((a) => a.id)).toEqual(["saldo-negativo:2026-11-18", "orcamento-estourado:2026-11"]);
    expect(list[0].target).toBe("/analise/painel/previsao-saldo");
  });
});
