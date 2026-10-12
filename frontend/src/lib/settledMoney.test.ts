import { expect, it } from "vitest";
import { settledCents, settledTotals } from "./settledMoney";
const base = { value: 100, adjusted_value: null, total_installments: null, type: "despesa" as const, status: "pago" as const, date: "2026-10-12", installment: false };

it("counts settled parcels, excludes transfers and scheduled money, and conserves cents", () => {
  const parcel = { ...base, installment: true, total_installments: 3 };
  expect(["2026-10", "2026-11", "2026-12", "2027-01"].map(m => settledCents(parcel, m))).toEqual([3333, 3333, 3334, 0]);
  expect(settledTotals([
    { ...base, type: "receita", value: 3000 },
    { ...base, value: 123.45 }, parcel,
    { ...base, type: "transferencia", value: 75 },
    { ...base, type: "receita", status: "agendado", value: 500 },
  ])).toEqual({ income: 3000, expense: 156.78 });
});

it("reconciles even a one-cent purchase and honours the adjusted amount", () => {
  const parcel = { ...base, value: 0.01, installment: true, total_installments: 3 };
  expect(["2026-10", "2026-11", "2026-12"].reduce((sum, m) => sum + settledCents(parcel, m), 0)).toBe(1);
  expect(settledCents({ ...base, value: 12.35, adjusted_value: 10.10 })).toBe(1010);
  expect(settledCents({ ...base, status: "pendente" })).toBe(0);
});

it("does not count the invoice bank debit as another expense", () => {
  expect(settledTotals([base, { ...base, invoice_payment: true }])).toEqual({income:0,expense:100});
});
