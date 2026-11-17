import { describe, expect, it } from "vitest";
import { buildCommitments, buildFuture, passes } from "@/lib/budget/commitments";
import { monthlyFor, spentIn, specialLimitsFor, specialStatus, validateSpecial } from "@/lib/budget/specials";
import { cycleDates, limitChanges, limitsForBase } from "@/lib/budget/newPeriod";
import { buildStart, roundLimit } from "@/lib/budget/firstTime";
import type { MonthView, PlanItem } from "@/lib/budget/monthView";
import type { BudgetSpecial } from "@/lib/budget/server";
import type { BudgetSummary, Flow, Transaction } from "@/types/finnos";

const brl = (v: number) => `R$ ${Math.round(v)}`;
const item = (p: Partial<PlanItem>): PlanItem => ({ key: Math.random().toString(36), name: "x", date: "2026-11-20", value: 100, type: "despesa", state: "agendado", source: "fluxo", ...p });
const view = (items: PlanItem[], suggestions: PlanItem[] = []) => ({ month: "2026-11", today: "2026-11-13", when: "current", daysInMonth: 30, items, suggestions } as unknown as MonthView);

describe("Orçamento · compromissos", () => {
  it("counts what is left to pay, late items, receipts and what was paid", () => {
    const c = buildCommitments(view([
      item({ name: "Celular", date: "2026-11-05", value: 45, state: "realizado" }),
      item({ name: "Salário", date: "2026-11-05", value: 3100, type: "receita", state: "realizado" }),
      item({ name: "Internet", date: "2026-11-10", value: 120, state: "estimativa" }),
      item({ name: "Aluguel", date: "2026-11-15", value: 650 }),
      item({ name: "Fatura Roxinho", date: "2026-11-20", value: 420, source: "cartao", card_id: "c1", key: "card:c1:2026-11" }),
      item({ name: "Freela", date: "2026-11-25", value: 900, type: "receita", state: "estimativa" }),
    ], [item({ name: "Academia" })]), [{ id: "g1", name: "Viagem", value: 170 }]);
    expect(c.toPay).toBe(120 + 650 + 420);
    expect(c.late).toBe(1);
    expect(c.toReceive).toBe(900);
    expect(c.paid).toBe(45);
    expect(c.pendingSuggestions).toBe(1);
    expect(c.items.find((x) => x.name === "Internet")?.status).toBe("Estimativa · venceu há 3 dias");
    expect(c.items.find((x) => x.name === "Aluguel")?.status).toBe("Agendado · vence em 2 dias");
    expect(c.items.find((x) => x.kind === "meta")?.date).toBe("2026-11-30");
    expect(c.week).toHaveLength(7);
    expect(c.week[0].items.map((x) => x.name)).toContain("Internet");
    expect(c.items.filter((x) => passes(x, "pagar")).map((x) => x.name)).toEqual(["Internet", "Aluguel", "Fatura Roxinho", "Meta Viagem"]);
    expect(c.items.filter((x) => passes(x, "cartao")).map((x) => x.name)).toEqual(["Fatura Roxinho"]);
  });

  it("groups installments of the next months and ignores suggestions", () => {
    const f = (upcoming: unknown[]) => ({ upcoming } as unknown as Flow);
    const out = buildFuture([
      { month: "2026-12", flow: f([{ date: "2026-12-10", name: "Notebook (4/10)", value: 250, type: "despesa", kind: "parcela" }, { date: "2026-12-10", name: "Internet", value: 120, type: "despesa", kind: "fixa" }]) },
      { month: "2027-01", flow: f([{ date: "2027-01-10", name: "Notebook (5/10)", value: 250, type: "despesa", kind: "parcela" }, { date: "2027-01-15", name: "IPVA", value: 1200, type: "despesa", kind: "agendado", transaction_id: "t" }]) },
    ]);
    expect(out.map((x) => x.name)).toEqual(["Notebook", "IPVA"]);
    expect(out[0].note).toBe("Agendado · 2 parcelas até jan");
    expect(out[1].note).toBe("Agendado para 15/01");
  });
});

describe("Orçamento · planos especiais", () => {
  const sp = (p: Partial<BudgetSpecial>): BudgetSpecial => ({ id: "sp-1", name: "Praia", kind: "Férias", start: "2027-02-12", end: "2027-02-17", amount: 1800, source: "nova", monthly: 450, categories: [{ category_id: "hosp", name: "Hospedagem", limit: 900 }], ...p });
  it("moves through the phases", () => {
    expect(specialStatus(sp({}), "2026-11-13", 450, 0, brl).phase).toBe("Guardando");
    expect(specialStatus(sp({}), "2026-11-13", 1800, 0, brl).phase).toBe("Pronto");
    expect(specialStatus(sp({ source: "13", start: "2026-12-01", end: "2026-12-31" }), "2026-11-13", 0, 0, brl).phase).toBe("Pronto");
    const running = specialStatus(sp({}), "2027-02-14", 1800, 800, brl);
    expect(running.phase).toBe("Em andamento");
    expect(running.hint).toBe("Sobram R$ 1000 até 17/02/27.");
    expect(specialStatus(sp({}), "2027-03-01", 1800, 1900, brl).hint).toBe("Passou R$ 100 do previsto.");
  });
  it("adds the plan's limits only in the months it overlaps", () => {
    expect(specialLimitsFor("2027-02", [sp({})])).toEqual({ hosp: 900 });
    expect(specialLimitsFor("2027-03", [sp({})])).toEqual({});
  });
  it("saves until the month it starts and checks the form", () => {
    expect(monthlyFor("2026-11-13", "2027-02-12", 1800)).toBe(600);
    expect(validateSpecial({ name: "Natal", start: "2027-01-02", end: "2027-01-05", amount: 100, source: "13" })).toMatch(/dezembro/);
    expect(validateSpecial({ name: "X", start: "2027-01-05", end: "2027-01-02", amount: 100, source: "nova" })).toMatch(/depois/);
    expect(validateSpecial({ name: "X", start: "2027-01-02", end: "2027-01-05", amount: 100, source: "nova" })).toBeNull();
  });
  it("counts only the plan's categories inside its dates", () => {
    const t = (p: Partial<Transaction>) => ({ id: "x", type: "despesa", status: "pago", value: 100, date: "2027-02-13", category_id: "hosp", ...p } as Transaction);
    expect(spentIn(sp({}), [t({}), t({ date: "2027-02-20" }), t({ category_id: "merc" }), t({ status: "pendente" })])).toBe(100);
  });
});

describe("Orçamento · novo período", () => {
  it("builds the cycle dates", () => {
    expect(cycleDates("2026-12", "1")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(cycleDates("2026-12", "5")).toEqual({ start: "2026-12-05", end: "2027-01-04" });
  });
  it("starts the limits from the chosen base", () => {
    const categories = [{ id: "merc", group: "necessidades" as const }, { id: "alu", group: "necessidades" as const }, { id: "laz", group: "desejos" as const }, { id: "inv", group: "metas" as const }];
    const current = { merc: 600, alu: 1400, laz: 300, inv: 500 };
    expect(limitsForBase("anterior", { categories, current, income: 0 })).toEqual({ merc: 600, alu: 1400, laz: 300 });
    expect(limitsForBase("503020", { categories, current, income: 5000 })).toEqual({ merc: 750, alu: 1750, laz: 1500 });
    expect(limitsForBase("novo", { categories, current, income: 5000 })).toEqual({});
    expect(limitsForBase("modelo", { categories, current, income: 0, model: { merc: 500 } })).toEqual({ merc: 500 });
    const ch = limitChanges({ merc: 600, laz: 300 }, { merc: 700, laz: 300 }, { merc: "Mercado", laz: "Lazer" });
    expect(ch.kept).toEqual(["Lazer"]);
    expect(ch.changed).toEqual([{ name: "Mercado", from: 600, to: 700 }]);
  });
});

describe("Orçamento · primeira vez", () => {
  it("suggests limits from the average of the last months", () => {
    const b = (rows: [string, string, number][]) => ({ rows: rows.map(([category_id, name, spent]) => ({ category_id, name, spent, group: "necessidades" })) } as unknown as BudgetSummary);
    const s = buildStart({
      past: [b([["merc", "Mercado", 650], ["laz", "Lazer", 0]]), b([["merc", "Mercado", 770], ["laz", "Lazer", 160]]), b([["merc", "Mercado", 680], ["laz", "Lazer", 150]])],
      trends: [{ month: "a", label: "", income: 3100, expense: 2000, net: 0 }, { month: "b", label: "", income: 3100, expense: 2000, net: 0 }],
      upcoming: [{ date: "2026-11-15", name: "Aluguel", value: 650, type: "despesa", kind: "fixa", category_id: "alu" }],
      subscriptions: 55, goalsMonthly: 170,
    });
    expect(s.income).toBe(3100);
    expect(s.fixed).toEqual({ total: 650, names: ["Aluguel"] });
    expect(s.suggestions.map((x) => [x.name, x.value])).toEqual([["Mercado", 700], ["Lazer", 160]]);
    expect(roundLimit(701)).toBe(710);
  });
});

describe("Orçamento · plano especial só entra se incluído", () => {
  it("lists the months a plan touches", async () => {
    const { specialMonths } = await import("@/lib/budget/specials");
    expect(specialMonths({ start: "2026-12-20", end: "2027-01-05" })).toEqual(["2026-12", "2027-01"]);
  });
});

describe("Orçamento · meu percentual", () => {
  it("uses the person's own split and checks it adds up to 100", async () => {
    const { validSplit } = await import("@/lib/budget/prefs");
    expect(validSplit({ necessidades: 55, desejos: 25, futuro: 20 })).toBe(true);
    expect(validSplit({ necessidades: 55, desejos: 30, futuro: 20 })).toBe(false);
    const categories = [{ id: "merc", group: "necessidades" as const }, { id: "laz", group: "desejos" as const }];
    expect(limitsForBase("proprio", { categories, current: {}, income: 4000, split: { necessidades: 55, desejos: 25 } })).toEqual({ merc: 2200, laz: 1000 });
  });
});

describe("Orçamento · fechamento sugere estimativas", () => {
  it("suggests what repeated and is not expected next month", async () => {
    const { suggestEstimates } = await import("@/lib/budget/closing");
    const t = (name: string, date: string, value: number, extra: Partial<Transaction> = {}) => ({ id: name + date, name, date, value, type: "despesa", status: "pago", account_id: "nu", ...extra } as Transaction);
    const out = suggestEstimates({ months: ["2026-10", "2026-09", "2026-08"], expected: ["Internet"], history: [
      t("Conta de luz", "2026-10-20", 90), t("Conta de luz", "2026-09-21", 80), t("Internet", "2026-10-10", 99), t("Internet", "2026-09-10", 99),
      t("Aluguel", "2026-10-05", 1400, { fixed: true }), t("Aluguel", "2026-09-05", 1400, { fixed: true }), t("Presente", "2026-10-02", 200),
    ] });
    expect(out.map((x) => [x.name, x.value, x.day])).toEqual([["Conta de luz", 85, 21]]);
  });
});

describe("Orçamento · histórico", () => {
  it("starts at the first month with movement and marks closed, open and outdated months", async () => {
    const { buildHistory } = await import("@/lib/budget/history");
    const { emptyPlan } = await import("@/lib/budget/server");
    const t = (month: string, income: number, expense: number) => ({ month, label: "", income, expense, net: income - expense });
    const closing = (month: string, earned: number, spent: number) => ({ month, closed_at: "2026-11-01T00:00:00Z", earned, spent, result: earned - spent, daily_planned: 0, daily_spent: 0,
      allocation: [{ id: "meta:g", kind: "meta" as const, name: "Viagem", value: 300 }], categories: [{ category_id: "m", name: "Mercado", spent: 900, limit: 800 }] });
    const h = buildHistory([t("2026-07", 0, 0), t("2026-08", 3000, 2000), t("2026-09", 3000, 2500), t("2026-10", 3100, 2900)],
      (m) => (m === "2026-09" ? closing(m, 3000, 2500) : m === "2026-10" ? closing(m, 3100, 2800) : null), emptyPlan);
    expect(h.map((x) => [x.month, x.state])).toEqual([["2026-08", "aberto"], ["2026-09", "fechado"], ["2026-10", "desatualizado"]]);
    expect(h[1].saved).toBe(300);
    expect(h[1].withinLimits).toBe(false);
    expect(h[1].over).toEqual(["Mercado"]);
  });
});

describe("Orçamento · próximo passo e histórico", () => {
  it("asks to close last month early in the month and to plan the next one near the end", async () => {
    const { nextStep } = await import("@/lib/budget/nextStep");
    const base = { closed: () => false, planned: () => false, hadMovement: () => true, on: { fechar: true, planejar: true } };
    expect(nextStep({ ...base, today: "2026-11-03" })?.kind).toBe("fechar");
    expect(nextStep({ ...base, today: "2026-11-03", closed: () => true })?.kind).toBe("comecar");
    expect(nextStep({ ...base, today: "2026-11-03", closed: () => true, planned: () => true })).toBeNull();
    expect(nextStep({ ...base, today: "2026-11-22" })).toEqual({ kind: "planejar", month: "2026-12", to: "/orcamento/novo?mes=2026-12" });
    expect(nextStep({ ...base, today: "2026-11-22", on: { fechar: true, planejar: false } })).toBeNull();
  });
  it("counts what was expected and happened, and the forecast that misses most", async () => {
    const { forecastHits, savedByMonth } = await import("@/lib/budget/history");
    const { emptyPlan } = await import("@/lib/budget/server");
    const c = (est: [string, "aconteceu" | "aberto"][]) => ({ estimates: est.map(([name, outcome]) => ({ name, type: "receita" as const, value: 1, outcome })) }) as never;
    const h = forecastHits(["2026-09", "2026-10"], (m) => (m === "2026-09" ? c([["Freela", "aberto"], ["Salário", "aconteceu"]]) : c([["Freela", "aberto"], ["Salário", "aconteceu"]])));
    expect(h.rows.map((r) => r.pct)).toEqual([0.5, 0.5]);
    expect(h.worst).toEqual({ name: "Freela", times: 2, missed: 2 });
    const s = savedByMonth(["2026-10"], [{ deposits: [{ date: "2026-10-05", value: 300 }, { date: "2026-10-20", value: 50, kind: "retirada" }] }], (m) => ({ ...emptyPlan(m), planned_saving: 400 }));
    expect(s).toEqual([{ month: "2026-10", saved: 300, planned: 400 }]);
  });
});

describe("Orçamento · o que importa agora", () => {
  it("puts what needs a decision first, each with its action, and says when all is fine", async () => {
    const { buildHomeInsights } = await import("@/lib/budget/homeInsights");
    const base = { month: "2026-11", today: "2026-11-16", when: "current", daysLeft: 15, endBalance: 3000, lowest: { date: "2026-11-25", value: -200 }, alerts: [], suggestions: [],
      daily: { spent: 900, limit: 2000, percent: 0.45, elapsed: 0.5, allowance: 70 } };
    const view = { ...base,
      items: [{ key: "a", name: "Farmácia", date: "2026-11-08", value: 68, type: "despesa", state: "estimativa", source: "fluxo", transaction_id: "t1" }, { key: "b", name: "Aluguel", date: "2026-11-17", value: 1450, type: "despesa", state: "agendado", source: "fluxo" }],
      categories: [{ category_id: "c", name: "Compras", spent: 600, limit: 300, over: 300 }, { category_id: "m", name: "Mercado", spent: 400, limit: 600, over: 0 }] } as never;
    const out = buildHomeInsights(view, (n) => `R$ ${n}`);
    expect(out.map((i) => i.id)).toEqual(["negativo", "vencidas", "passou", "ritmo", "em-breve"]);
    expect(out[1].action?.to).toBe("/transacoes?month=2026-11&highlight=t1");
    expect(out[3].title).toBe("Nesse ritmo, Mercado passa R$ 200");
    expect(out[4].title).toBe("Aluguel vence amanhã");
    const calm = buildHomeInsights({ ...base, lowest: { date: "2026-11-30", value: 100 }, items: [], categories: [] } as never, (n) => `R$ ${n}`);
    expect(calm.map((i) => i.id)).toEqual(["tudo-certo"]);
    expect(buildHomeInsights(view, (n) => `R$ ${n}`, { categoria: false }).some((i) => i.id === "passou")).toBe(false);
  });
});
