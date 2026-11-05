import { describe, expect, it } from "vitest";
import type { Transaction } from "@/types/finnos";
import { matchImportRows, nameSimilarity, scorePair } from "./importMatching";

const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t1", name: "Padaria", value: 12.5, type: "despesa", status: "pago", date: "2026-11-03",
  account_id: "a", account_name: "A", card_id: null, card_name: null, to_account_id: null, to_account_name: null,
  category_id: "alim", category_name: "Alimentação", category_color: null, category_icon: null, fixed: false,
  recurrence: null, installment: false, total_installments: null, current_installment: null, installment_value: null,
  adjusted_value: null, attachment: null, notes: null, created_at: "2026-11-03T08:40:00", ...over,
});
const row = { id: "r1", date: "2026-11-03", value: 12.5, type: "despesa" as const, description: "COMPRA PADARIA BOM PAO", category_id: "alim", time: "08:31" };

describe("nameSimilarity", () => {
  it("ignores bank filler words", () => {
    expect(nameSimilarity("COMPRA PIX PADARIA BOM PAO", "Padaria")).toBe(1);
    expect(nameSimilarity("PIX ENVIADO", "Padaria")).toBe(0);
    expect(nameSimilarity("PIX RECEBIDO", "Pix recebido")).toBe(1);
  });
});

describe("scorePair", () => {
  it("same date, value, name, category and time is a duplicate", () => {
    const r = scorePair(row, tx({}));
    expect(r.score).toBe(1);
    expect(r.reasons).toEqual(["mesma data", "mesmo valor", "nome parecido", "mesma categoria", "horário próximo"]);
  });
  it("one day off with a slightly different value is only similar", () => {
    expect(scorePair({ ...row, date: "2026-11-04", value: 13.1, category_id: null, time: null }, tx({})).score).toBe(0.57);
  });
  it("ignores other directions, far dates and different values", () => {
    expect(scorePair(row, tx({ type: "receita" })).score).toBe(0);
    expect(scorePair(row, tx({ date: "2026-11-09" })).score).toBe(0);
    expect(scorePair(row, tx({ value: 40 })).score).toBe(0);
  });
});

describe("matchImportRows", () => {
  it("matches each registered transaction to one line only", () => {
    const rows = [row, { ...row, id: "r2" }];
    const out = matchImportRows(rows, [tx({})]);
    expect(out.get("r1")?.level).toBe("duplicate");
    expect(out.get("r2")?.level).toBe("new");
  });
});
