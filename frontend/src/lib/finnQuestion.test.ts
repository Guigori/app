import { describe, expect, it } from "vitest";
import { parsePeriod, parseQuestion, previousPeriod, type QuestionContext } from "./finnQuestion";

const ctx: QuestionContext = {
  today: "2026-11-05",
  categories: [{ id: "rest", name: "Restaurantes" }, { id: "trans", name: "Transporte" }, { id: "home", name: "Moradia" }],
  accounts: [{ id: "itau", name: "Itaú" }],
  cards: [{ id: "nu", name: "Nubank" }],
  names: ["uber trabalho", "uber", "onibus", "ifood", "mercado do mes", "aluguel"],
};

describe("FINNOS IA reads the period", () => {
  it("knows the usual ways of naming a period", () => {
    expect(parsePeriod("quanto gastei hoje", ctx.today).period).toMatchObject({ start: "2026-11-05", end: "2026-11-05" });
    expect(parsePeriod("gastos do mes passado", ctx.today).period).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
    expect(parsePeriod("ultimos 3 meses", ctx.today).period).toMatchObject({ start: "2026-09-01", end: "2026-11-05", months: ["2026-09", "2026-10", "2026-11"] });
    expect(parsePeriod("ultimos 7 dias", ctx.today).period).toMatchObject({ start: "2026-10-30", end: "2026-11-05" });
    expect(parsePeriod("em dezembro", ctx.today).period).toMatchObject({ start: "2025-12-01", end: "2025-12-31" });
    expect(parsePeriod("quanto gastei", ctx.today)).toMatchObject({ explicit: false, period: { start: "2026-11-01", end: "2026-11-30" } });
  });

  it("compares a whole month with the previous one", () => {
    expect(previousPeriod(parsePeriod("outubro", ctx.today).period)).toMatchObject({ start: "2026-09-01", end: "2026-09-30" });
  });
});

describe("FINNOS IA reads the question", () => {
  it("finds establishments, categories, cards and the operation", () => {
    const q = parseQuestion("Quanto gastei de Uber nos últimos 3 meses comparado com o ônibus?", ctx);
    expect(q.op).toBe("compare");
    expect(q.entities.map((e) => [e.kind, e.term])).toEqual([["merchant", "uber"], ["merchant", "onibus"]]);
    expect(parseQuestion("quais meus maiores gastos em restaurantes", ctx)).toMatchObject({ op: "top", entities: [{ kind: "category", id: "rest" }] });
    expect(parseQuestion("quanto paguei no cartão nubank este mês", ctx).entities).toEqual([{ kind: "card", id: "nu", name: "Nubank", term: "nubank" }]);
    expect(parseQuestion("quanto recebi em outubro", ctx)).toMatchObject({ op: "total", type: "receita" });
    expect(parseQuestion("quantas vezes pedi ifood", ctx)).toMatchObject({ op: "count", entities: [{ term: "ifood" }] });
    expect(parseQuestion("evolução do transporte", ctx).op).toBe("trend");
    expect(parseQuestion("vou fechar o mês no positivo?", ctx).op).toBe("forecast");
  });

  it("keeps the subject on a short follow-up", () => {
    const first = parseQuestion("quanto gastei de uber este mês", ctx);
    const next = parseQuestion("e no mês passado?", ctx, first);
    expect(next.entities.map((e) => e.term)).toEqual(["uber"]);
    expect(next.period).toMatchObject({ start: "2026-10-01" });
    expect(parseQuestion("me conta uma piada", ctx, first).vague).toBe(true);
  });

  it("uses an alias the user taught", () => {
    const q = parseQuestion("quanto gastei com lanche", { ...ctx, aliases: { lanche: "rest" } });
    expect(q.entities).toEqual([{ kind: "category", id: "rest", name: "Restaurantes", term: "lanche" }]);
  });

  it("says when it understood nothing", () => {
    expect(parseQuestion("me conta uma piada", ctx).vague).toBe(true);
  });
});
