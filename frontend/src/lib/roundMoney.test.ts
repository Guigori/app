import { expect, it } from "vitest";
import fixtures from "../../fixtures/finance-money-parity.json";
import { moneyCents, roundBRL } from "./roundMoney";

it("matches the exact same FINNOS currency fixtures in Python and TypeScript", () => {
  for (const item of fixtures.rounding) {
    const value = Number(item.input);
    expect(moneyCents(value), item.input).toBe(item.cents);
    expect(roundBRL(value), item.input).toBe(item.cents / 100);
  }
});

it("rejects invalid numeric values, not NaN or infinities", () => {
  for (const amount of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
    expect(() => moneyCents(amount)).toThrow("Valor monetário");
  }
});

it("reconciles negative opening account balances with real cash movements", () => {
  for (const item of fixtures.overdraft) {
    const value = (item.opening_cents + item.income_cents - item.transfer_out_cents) / 100;
    expect(moneyCents(value)).toBe(item.expected_cents);
  }
});
