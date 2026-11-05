import { expect, it } from "vitest";
import { transferBalances } from "./transferBalances";
import type { Account } from "@/types/finnos";

const nu = { id: "nu", name: "Nubank", balance: 200 } as Account;
const inter = { id: "inter", name: "Inter", balance: 200 } as Account;

it("shows what each account keeps after a transfer", () => {
  expect(transferBalances(nu, inter, 200)).toMatchObject({ from: 0, to: 400 });
  expect(transferBalances(nu, undefined, 300).from).toBe(-100);
});

it("does not count twice the transfer being edited", () => {
  // Editing a 200 transfer from Nubank to Inter that is already in both balances.
  const edited = { fromId: "nu", toId: "inter", value: 200 };
  expect(transferBalances({ ...nu, balance: 0 }, { ...inter, balance: 400 }, 150, edited)).toMatchObject({ from: 50, to: 350 });
});
