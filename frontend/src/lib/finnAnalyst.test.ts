import { describe, expect, it } from "vitest";
import { answer, type AnalystData } from "./finnAnalyst";
import { norm, parseQuestion, type QuestionContext } from "./finnQuestion";
import type { Account, Category, RadarSignal, Transaction } from "@/types/finnos";

const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2), name: "Uber", value: 30, type: "despesa", status: "pago", date: "2026-11-02",
  account_id: "itau", account_name: "Itaú", card_id: null, card_name: null, to_account_id: null, to_account_name: null,
  category_id: "trans", category_name: "Transporte", category_color: null, category_icon: null, fixed: false, recurrence: null,
  installment: false, total_installments: null, current_installment: null, installment_value: null, adjusted_value: null,
  attachment: null, notes: null, created_at: "2026-11-02", ...over,
});

const transactions = [
  tx({ value: 30 }), tx({ value: 50, date: "2026-11-03" }), tx({ value: 20, date: "2026-10-10" }),
  tx({ name: "Ônibus", value: 10 }), tx({ name: "Ônibus", value: 10, date: "2026-11-04" }),
  tx({ name: "iFood", value: 60, category_id: "rest", category_name: "Restaurantes" }),
  tx({ name: "Jantar", value: 90, status: "agendado", date: "2026-11-20", category_id: "rest", category_name: "Restaurantes" }),
  tx({ name: "Salário", value: 5000, type: "receita", category_id: "renda", category_name: "Renda" }),
  tx({ name: "Para o Nubank", value: 500, type: "transferencia", category_id: null }),
];
const categories = [{ id: "trans", name: "Transporte" }, { id: "rest", name: "Restaurantes" }, { id: "renda", name: "Renda" }] as Category[];
const accounts = [{ id: "itau", name: "Itaú", institution: "Itaú", balance: 4200, active: true }] as Account[];
const ctx: QuestionContext = { today: "2026-11-05", categories, accounts, cards: [], names: [...new Set(transactions.map((t) => norm(t.name)))] };
const data: AnalystData = {
  today: "2026-11-05", transactions, categories, accounts,
  radar: [{ id: "budget-trans", type: "risk", severity: "high", score: 88, title: "Transporte está perto do limite", metric: "Restam R$ 20,00", related_entity_id: "trans" } as RadarSignal],
};
const ask = (text: string) => answer(parseQuestion(text, ctx), data);

describe("FINNOS IA answers with the user's data", () => {
  it("totals an establishment, compares with the previous month and notices the related alert", () => {
    const a = ask("quanto gastei de uber este mês?");
    expect(a.text).toContain("**R$ 80,00** com Uber");
    expect(a.text).toContain("2 lançamentos");
    expect(a.text).toContain("outubro de 2026 foram R$ 20,00 (+300%)");
    expect(a.insight).toBe("Transporte está perto do limite (Restam R$ 20,00).");
    expect(a.followUps[0]).toBe("Evolução de Uber por mês");
  });

  it("says what is still scheduled, apart from what was paid", () => {
    expect(ask("quanto gastei em restaurantes").text).toContain("Ainda há **R$ 90,00** agendado ou pendente.");
  });

  it("compares two establishments", () => {
    const a = ask("compare uber e ônibus este mês");
    expect(a.text).toContain("Uber: **R$ 80,00** em 2 lançamentos");
    expect(a.text).toContain("Ônibus: **R$ 20,00**");
    expect(a.text).toContain("custou 4× mais");
    expect(a.visual?.chart?.type).toBe("bar");
  });

  it("ranks categories and never counts a transfer as spending", () => {
    const a = ask("para onde foi meu dinheiro este mês");
    expect(a.text).toContain("**Transporte**: R$ 100,00");
    expect(a.visual?.chart?.data.map((d) => d.name)).toEqual(["Transporte", "Restaurantes"]);
  });

  it("answers income, balance and trend questions", () => {
    expect(ask("quanto recebi este mês").text).toContain("Você recebeu **R$ 5.000,00**");
    expect(ask("qual meu saldo").text).toContain("**R$ 4.200,00**");
    const trend = ask("evolução de uber");
    expect(trend.visual?.chart?.data).toHaveLength(6);
    expect(trend.visual?.chart?.data.at(-1)).toEqual({ name: "nov/26", value: 80 });
  });

  it("names the single biggest expense when asked for one", () => {
    expect(ask("qual foi meu maior gasto este mês?").text).toContain("Seu maior gasto neste mês foi **iFood**, R$ 60,00");
  });

  it("suggests where to save without blind cuts", () => {
    expect(ask("onde posso economizar?").text).toContain("Reduzir 10% neles libera cerca de **R$ 16,00**");
  });

  it("links to the cash flow already filtered", () => {
    expect(ask("quanto gastei em restaurantes").links[0].to).toBe("/fluxo?month=2026-11&metric=despesas&category_id=rest");
  });
});
