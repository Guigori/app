import { describe, expect, it } from "vitest";
import { parseFinancialFile } from "./importFinancial";
import { statementLinesToCsv } from "./pdfStatement";

describe("statementLinesToCsv", () => {
  it("reads date, description and value; ignores headers, balances and totals", () => {
    const csv = statementLinesToCsv([
      "Extrato de conta corrente — Novembro 2026",
      "DATA HISTÓRICO VALOR SALDO",
      "01/11 SALDO ANTERIOR 1.000,00",
      "03/11 COMPRA CARTAO PADARIA BOM PAO -12,50 987,50",
      "05/11/2026 PIX RECEBIDO JOAO 200,00 1.187,50",
      "06/11 TARIFA PACOTE 29,90 D",
      "TOTAL DO PERÍODO 157,60",
    ], 2026);
    expect(csv).toBe(["Data;Descrição;Valor", "2026-11-03;COMPRA CARTAO PADARIA BOM PAO;-12,50", "2026-11-05;PIX RECEBIDO JOAO;200,00", "2026-11-06;TARIFA PACOTE;-29,90"].join("\n"));
  });
  it("feeds the existing importer", () => {
    const rows = parseFinancialFile(statementLinesToCsv(["03/11 PADARIA -12,50 987,50", "05/11 SALARIO 3.100,00 4.087,50"], 2026), "statement");
    expect(rows.map((r) => [r.date, r.type, r.value])).toEqual([["2026-11-03", "despesa", 12.5], ["2026-11-05", "receita", 3100]]);
  });
});
