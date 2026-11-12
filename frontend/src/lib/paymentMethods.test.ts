import { expect, test } from "vitest";
import { invoiceClosingFor, methodKey, paymentEffect, paymentMethods } from "@/lib/paymentMethods";
import type { Account, CreditCard } from "@/types/finnos";

const account = (over: Partial<Account>): Account => ({
  id: "a", name: "Itaú", institution: "Itaú", type: "corrente", color: "#EC7000", initial_balance: 0,
  active: true, created_at: "2026-01-01", balance: 2200, total_income: 0, total_expense: 0, ...over,
} as Account);
const card = (over: Partial<CreditCard>): CreditCard => ({
  id: "c", name: "Nubank", institution: "Nubank", color: "#820AD1", limit: 1000, closing_day: 3, due_day: 10,
  payment_account_id: null, active: true, ...over,
} as CreditCard);

test("one list of payment methods with the defaults first", () => {
  const accounts = [account({}), account({ id: "b", name: "Inter", is_default: true, created_at: "2026-02-01" }),
    account({ id: "v", name: "VR Refeição", type: "beneficio" }), account({ id: "d", name: "Dinheiro", type: "carteira" })];
  const cards = [card({}), card({ id: "x", name: "Itaú Visa", is_default: true })];
  const methods = paymentMethods(accounts, cards);
  expect(methods.map((m) => m.label)).toEqual([
    "Itaú Visa · Crédito", "Nubank · Crédito", "Inter · Pix/Débito", "Itaú · Pix/Débito", "VR Refeição", "Dinheiro"]);
  // A card purchase still carries an account for the server: the default bank.
  expect(methods[0]).toMatchObject({ cardId: "x", accountId: "b", kind: "credito" });
  expect(methodKey("b", null)).toBe("account:b");
});

test("shows the effect before saving", () => {
  const accounts = [account({ balance: 2200 })];
  const cards = [card({ closing_day: 3 })];
  const [credit, debit] = paymentMethods(accounts, cards);
  expect(paymentEffect(credit, 50, "2026-11-04", accounts, cards)).toBe("Vai para a fatura que fecha em 03/12.");
  expect(paymentEffect(credit, 50, "2026-11-03", accounts, cards)).toBe("Vai para a fatura que fecha em 03/11.");
  expect(paymentEffect(debit, 88.55, "2026-11-04", accounts, cards)).toMatch(/fica R\$\s?2\.111,45/);
  expect(invoiceClosingFor("2026-12-30", 29)).toBe("2027-01-29");
  expect(invoiceClosingFor("2026-02-15", 31)).toBe("2026-02-28");
});
