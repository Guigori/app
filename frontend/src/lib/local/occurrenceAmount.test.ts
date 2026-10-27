import { expect, it } from "vitest";
import parity from "../../../fixtures/finance-occurrence-amount-parity.json";
import { occurrenceAmount } from "./engine";

it("matches Python cents for every synthetic legacy occurrence", () => {
  for (const { id, tx, expected_cents } of parity.cases) {
    const amount = occurrenceAmount(tx);
    expect(Math.round(amount * 100), id).toBe(expected_cents);
  }
});

it("rejects invalid imported installment positions instead of hiding their cost", () => {
  expect(() => occurrenceAmount({
    value: 100, installment: true, total_installments: 3, current_installment: 4,
  })).toThrow("Parcela atual inválida.");
});
