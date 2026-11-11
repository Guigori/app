import { describe, expect, it } from "vitest";
import { answer, type AnalystData } from "./finnAnalyst";
import { norm, parseQuestion, type QuestionContext } from "./finnQuestion";
import type { Account, Category, RadarSignal, Transaction } from "@/types/finnos";
import type { FinnosGoal } from "@/lib/goals";

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
    expect(ask("quanto gastei em restaurantes").links[0].to).toBe("/transacoes?aba=caixa&month=2026-11&metric=despesas&category_id=rest");
  });
});

describe("FINNOS IA reads the month against the usual", () => {
  const usual = (m: string) => [tx({ name: "iFood", value: 30, date: `${m}-02`, category_id: "rest", category_name: "Restaurantes" })];
  const rows = [
    ...usual("2026-08"), ...usual("2026-09"), ...usual("2026-10"),
    tx({ name: "iFood", value: 70, date: "2026-11-02", category_id: "rest", category_name: "Restaurantes" }),
    tx({ name: "Viagem", value: 900, date: "2026-07-10", category_id: "trip", category_name: "Viagem" }),
  ];
  const d: AnalystData = { today: "2026-11-05", transactions: rows, categories, accounts, radar: [] };

  it("finds where spending is above a usual month, comparing the same days", () => {
    const a = answer(parseQuestion("onde estou gastando mais do que o normal?", ctx), d);
    expect(a.query.op).toBe("unusual");
    expect(a.text).toContain("Restaurantes está 2,3× o normal");
    expect(a.text).toContain("economiza cerca de **R$ 40,00** por mês");
    expect(a.visual?.chart).toMatchObject({ type: "hbar", data: [{ name: "Restaurantes", value: 40 }] });
    expect(a.steps?.[0]).toContain("os mesmos 5 dias");
  });

  it("names the costliest months of the year and why", () => {
    const a = answer(parseQuestion("quais meses custaram mais este ano e por quê?", ctx), d);
    expect(a.query.op).toBe("months");
    expect(a.text).toContain("Julho liderou com **R$ 900,00**, principalmente por causa de Viagem");
    expect(a.visual?.chart?.data).toHaveLength(11);
  });

  it("says whether the money lasts until a day, from the balance, the pace and what is scheduled", () => {
    const flow = { upcoming: [{ date: "2026-11-10", name: "Aluguel", value: 1000, type: "despesa", kind: "fixa" }] } as AnalystData["flow"];
    const lasts = answer(parseQuestion("meu dinheiro dura até o dia 15?", ctx), { ...d, flow });
    expect(lasts.query).toMatchObject({ op: "runway", day: 15 });
    // 4.200 in the bank, 2,33 a day of day-to-day spending for 10 days, 1.000 of rent.
    expect(lasts.text).toContain("Sim. No seu ritmo atual, devem sobrar cerca de **R$ 3.176,67** em 15/11.");
    const short = answer(parseQuestion("meu dinheiro dura até o dia 15?", ctx), { ...d, flow: { upcoming: [{ date: "2026-11-10", name: "Aluguel", value: 5000, type: "despesa", kind: "fixa" }] } as AnalystData["flow"] });
    expect(short.text).toContain("Não: no seu ritmo atual, o saldo fica negativo");
  });
});

describe("FINNOS IA knows the user's goals", () => {
  const goal = {
    id: "nb", name: "Meu notebook novo", category: "Compras", mode: "inteligente", target: 6000, saved: 1500, months: 6,
    contribution: 911.16, frequency: "Mensal", account: "x", strategy: "equilibrado", remind: true, radar: true,
    createdAt: "2026-09-01T12:00:00Z", deposits: [{ date: "2026-10-05", value: 1000, kind: "aporte" }],
  } as FinnosGoal;
  const spend = ["2026-08", "2026-09", "2026-10"].map((m) => tx({ name: "iFood", value: 300, date: `${m}-10`, category_id: "rest", category_name: "Restaurantes" }));
  const d: AnalystData = { today: "2026-11-05", transactions: spend, categories, accounts, goals: [goal], radar: [] };
  const withGoals = { ...ctx, goals: [{ id: "nb", name: "Meu notebook novo" }] };

  it("answers about one goal named in the question, with the monthly amount and where to cut", () => {
    const q = parseQuestion("quanto falta para a meta do notebook?", withGoals);
    expect(q).toMatchObject({ op: "goals", entities: [{ kind: "goal", id: "nb" }] });
    const a = answer(q, d);
    expect(a.text).toContain("Na meta **Meu notebook novo** você tem R$ 1.500,00 de R$ 6.000,00 (25%). Faltam **R$ 4.500,00**: R$ 1.125,00 por mês para chegar em março de 2027.");
    expect(a.insight).toContain("Cortando 10% de Restaurantes você libera cerca de R$ 30,00 por mês");
    expect(a.visual?.chart?.type).toBe("hbar");
  });

  it("says there are no goals yet, instead of guessing", () => {
    expect(answer(parseQuestion("como estão minhas metas?", ctx), { ...d, goals: [] }).text).toContain("ainda não tem metas");
  });
});

describe("FINNOS IA explains how to spend less on what was asked", () => {
  it("shows where the money of a category went, how it compares and concrete ideas", () => {
    const a = ask("o que foi gasto em transporte e como posso economizar?");
    expect(a.text).toContain("Neste mês você gastou **R$ 100,00** com Transporte");
    expect(a.text).toContain("acima** da sua média");
    expect(a.text).toContain("Como economizar com Transporte");
    expect(a.text).toContain("Uber (R$ 80,00, 2×)");
    expect(a.visual?.items?.[0].label).toBe("Uber");
    expect(a.followUps[0]).toBe("Crie um limite para Transporte no orçamento");
  });
});
