import { describe, expect, it } from "vitest";
import { parseBRNumber, parseReceiptText, parseRegisterText } from "./registerParsing";

const accounts = [
  { id: "nu", name: "Nubank", institution: "Nubank" },
  { id: "inter", name: "Inter", institution: "Banco Inter" },
];
const categories = [
  { id: "transp", name: "Transporte" },
  { id: "alim", name: "Alimentação" },
  { id: "renda", name: "Renda" },
];
const ctx = { accounts, categories, today: "2026-11-04" };

describe("parseBRNumber", () => {
  it("reads Brazilian formats", () => {
    expect(parseBRNumber("1.234,56")).toBe(1234.56);
    expect(parseBRNumber("45,9")).toBe(45.9);
    expect(parseBRNumber("3100")).toBe(3100);
  });
});

describe("parseRegisterText", () => {
  it("understands an expense with account, category and date", () => {
    const r = parseRegisterText("Paguei R$ 45 no Uber com o Nubank ontem", ctx);
    expect(r).toMatchObject({ value: 45, kind: "Despesa", accountId: "nu", categoryId: "transp", date: "2026-11-03", name: "Uber" });
  });
  it("understands income", () => {
    const r = parseRegisterText("Recebi 3100 de salário", ctx);
    expect(r).toMatchObject({ value: 3100, kind: "Receita", categoryId: "renda" });
  });
  it("splits origin and destination of a transfer", () => {
    const r = parseRegisterText("Transferi 200 do Nubank para o Inter", ctx);
    expect(r).toMatchObject({ value: 200, kind: "Transferência", accountId: "nu", destinationId: "inter", categoryId: null });
  });
  it("prefers the amount over a day number", () => {
    const r = parseRegisterText("dia 12 café 9 reais", ctx);
    expect(r.value).toBe(9);
    expect(r.date).toBe("2026-11-12");
    expect(r.categoryId).toBe("alim");
  });
});

describe("parseReceiptText", () => {
  it("reads total, date and merchant from OCR text", () => {
    const r = parseReceiptText("PADARIA BOM PAO LTDA\nCNPJ 00.000.000/0001-00\n12/10/2026 08:31\nPAO FRANCES 4,50\nCAFE 6,00\nVALOR TOTAL R$ 10,50");
    expect(r).toEqual({ value: 10.5, date: "2026-10-12", name: "PADARIA BOM PAO LTDA" });
  });
});
