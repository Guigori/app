import { describe, expect, it } from "vitest";
import { signedAccountMovement } from "./accountMovement";

const source = "a";
const destination = "b";
const transaction = { account_id: source, to_account_id: destination, type: "transferencia" as const, value: 25 };
describe("account-relative transaction presentation", () => {
  it("shows negative at origin and positive at destination", () => {
    expect(signedAccountMovement(source, transaction)).toBe(-25);
    expect(signedAccountMovement(destination, transaction)).toBe(25);
  });
  it("keeps ordinary income and expense signs", () => {
    expect(signedAccountMovement(source, { ...transaction, type: "receita" })).toBe(25);
    expect(signedAccountMovement(source, { ...transaction, type: "despesa" })).toBe(-25);
  });
  it("never attributes a foreign account's movement to the viewed account", () => {
    expect(signedAccountMovement("other", transaction)).toBe(0);
  });
});
