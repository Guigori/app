import { expect, it } from "vitest";
import { parseFinancialFile } from "./importFinancial";

const pick = (text: string, kind: "statement" | "invoice" = "statement") =>
  parseFinancialFile(text, kind).map(({ date, description, value, type, selected, blocked }) =>
    ({ date, description, value, type, selected, blocked: !!blocked }));

it("uses the mapped amount column, never the running balance", () => {
  const csv = "Data;Descrição;Valor;Saldo\n03/11/2026;Mercado;-10,00;990,00\n04/11/2026;Salário;3.100,00;4.090,00";
  expect(pick(csv)).toEqual([
    { date: "2026-11-03", description: "Mercado", value: 10, type: "despesa", selected: true, blocked: false },
    { date: "2026-11-04", description: "Salário", value: 3100, type: "receita", selected: true, blocked: false },
  ]);
});

it("keeps quoted decimals with commas and their sign", () => {
  expect(pick('03/11/2026,Mercado,"-10,50"')).toEqual([
    { date: "2026-11-03", description: "Mercado", value: 10.5, type: "despesa", selected: true, blocked: false },
  ]);
  expect(pick('Data,Descrição,Valor\n2026-11-03,"Padaria, centro","1.234,56"')[0])
    .toMatchObject({ description: "Padaria, centro", value: 1234.56, type: "receita" });
});

it("never turns invoice credits, refunds or payments into new purchases", () => {
  const csv = "data;titulo;valor\n03/11/2026;Estorno;-100,00\n04/11/2026;Pagamento recebido;-500,00\n05/11/2026;Livraria;80,00";
  const rows = pick(csv, "invoice");
  expect(rows.filter((r) => r.blocked).map((r) => r.description)).toEqual(["Estorno", "Pagamento recebido"]);
  expect(rows.filter((r) => r.blocked).every((r) => !r.selected)).toBe(true);
  expect(rows.find((r) => r.description === "Livraria")).toMatchObject({ value: 80, type: "despesa", selected: true });
});

it("treats positive OFX amounts on a card invoice as credits", () => {
  const ofx = "<OFX><STMTTRN><DTPOSTED>20261103<TRNAMT>-45.90<NAME>Restaurante</STMTTRN><STMTTRN><DTPOSTED>20261104<TRNAMT>45.90<NAME>Ajuste</STMTTRN></OFX>";
  const rows = pick(ofx, "invoice");
  expect(rows[0]).toMatchObject({ description: "Restaurante", value: 45.9, selected: true, blocked: false });
  expect(rows[1]).toMatchObject({ description: "Ajuste", selected: false, blocked: true });
});

it("asks for review instead of guessing when a headerless row has two amounts", () => {
  const [row] = parseFinancialFile("03/11/2026;Mercado;-10,00;990,00", "statement");
  expect(row).toMatchObject({ value: 10, type: "despesa", selected: false });
  expect(row.review_reason).toMatch(/mais de um valor/i);
});
