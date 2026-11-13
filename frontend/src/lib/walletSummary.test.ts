import { expect, it } from "vitest";
import { bankInitials, bankRows, benefitTiles, carouselOrder, composition, upcomingInvoices, walletIndicators, walletWarnings } from "@/lib/walletSummary";
import type { Account, CreditCard } from "@/types/finnos";

const account = (id: string, type: Account["type"], balance: number, extra: Partial<Account> = {}): Account => ({
  id, name: id, institution: extra.institution ?? id, type, color: "#000000", initial_balance: 0, active: true,
  balance, total_income: 0, total_expense: 0, created_at: "2026-01-01T00:00:00Z", ...extra,
});
const card = (id: string, extra: Partial<CreditCard> = {}): CreditCard => ({
  id, name: id, institution: extra.institution ?? id, color: "#111111", limit: 1000, closing_day: 1, due_day: 10,
  payment_account_id: null, payment_account_name: null, active: true, invoice_paid: false, current_invoice: 0,
  payable_invoice: 0, payable_cycle: null, payable_due: null, future_installments: 0, used: 0, available: 1000,
  used_percent: 0, cycle_start: "2026-11-01", next_closing: "2026-12-01", next_due: "2026-12-10",
  best_purchase_day: "2026-12-01", created_at: "2026-01-01T00:00:00Z", ...extra,
});

it("keeps cash, benefits, invoices and free limit apart and never sums them", () => {
  const ind = walletIndicators(
    [account("itau", "corrente", 1000.5), account("bolso", "carteira", 50), account("vr", "beneficio", 300), account("velha", "corrente", 999, { active: false })],
    [card("nu", { current_invoice: 200, payable_invoice: 100, available: 700 }), card("off", { active: false, current_invoice: 50 })],
  );
  expect(ind).toEqual({ cashCents: 105050, bankCents: 100050, physicalCents: 5000, benefitsCents: 30000, invoicesCents: 30000, freeLimitCents: 70000, limitCents: 100000 });
  // The bar shows accounts, invested, benefits and card debt side by side; shares only for the bar.
  expect(composition(ind, 200000).map((p) => [p.key, p.cents])).toEqual([["accounts", 105050], ["invested", 200000], ["benefits", 30000], ["debt", 30000]]);
});

it("lists closed and open invoices by due date and flags the overdue one", () => {
  const list = upcomingInvoices([
    card("nu", { current_invoice: 200, next_due: "2026-12-10", payable_invoice: 100, payable_due: "2026-11-10" }),
    card("inter", { current_invoice: 80, next_due: "2026-11-20" }),
  ], "2026-11-12");
  expect(list.map((i) => [i.cardId, i.state, i.amountCents])).toEqual([["nu", "overdue", 10000], ["inter", "open", 8000], ["nu", "open", 20000]]);
});

it("warns about a balance difference, a negative account and an overdue invoice", () => {
  const accounts = [account("itau", "corrente", -150, { overdraft_limit: 500 }), account("inter", "corrente", -10)];
  const cards = [card("nu", { payable_invoice: 100, payable_due: "2026-11-10" })];
  const warnings = walletWarnings(accounts, upcomingInvoices(cards, "2026-11-12"), [
    { id: "r1", scope: "account", account_id: "itau", card_id: null, period_end: "2026-10-31", difference: -29.9, pending: 1 },
    { id: "r2", scope: "account", account_id: "inter", card_id: null, period_end: "2026-10-31", difference: 0, pending: 0 },
  ], cards);
  expect(warnings.map((w) => [w.key, w.tone])).toEqual([
    ["neg:inter", "danger"], ["late:nu", "danger"], ["rec:r1", "attention"], ["neg:itau", "attention"],
  ]);
  expect(warnings.find((w) => w.key === "rec:r1")?.detail).toMatch(/29,90 a menos/);
});

it("eight banks: one row each, search, sorting, the default first and empty banks marked", () => {
  const accounts = ["Inter", "Itaú", "Bradesco", "Nubank", "Banco do Brasil", "Caixa", "Santander", "C6"].map((n, i) =>
    account(n, "corrente", i === 2 ? 0 : (i + 1) * 100, { institution: n, is_default: n === "Nubank" }));
  const rows = bankRows([...accounts, account("Itaú poupança", "poupanca", 50, { institution: "Itaú" })], [card("visa", { institution: "Santander" }), card("so-credito", { institution: "Mercado Pago" })], []);
  expect(rows).toHaveLength(9);
  expect(rows[0].name).toBe("Nubank");
  const itau = rows.find((r) => r.name === "Itaú")!;
  expect([itau.accountsCents, itau.products]).toEqual([25000, "Conta · Poupança · Pix · Débito"]);
  expect(rows.find((r) => r.name === "Bradesco")?.empty).toBe(true);
  const onlyCard = rows.find((r) => r.name === "Mercado Pago")!;
  expect([onlyCard.accountsCents, onlyCard.products]).toEqual([null, "Só cartão de crédito"]);
  expect(bankRows(accounts, [], [], { query: "itau" }).map((r) => r.name)).toEqual(["Itaú"]);
  expect(bankRows(accounts, [], [], { sort: "az" })[0].name).toBe("Banco do Brasil");
  expect(bankRows([...accounts, account("vr", "beneficio", 10), account("bolso", "carteira", 10)], [], []).some((r) => ["vr", "bolso"].includes(r.name))).toBe(false);
});

it("two letters for each bank logo", () => {
  expect(["Nubank", "Itaú Unibanco", "Banco do Brasil", "Banco Inter", "Mercado Pago", "C6 Bank"].map(bankInitials)).toEqual(["Nu", "It", "BB", "In", "MP", "C6"]);
});

it("one benefit tile per benefit, with what is left of the month", () => {
  const multi = account("caju", "beneficio", 640, { wallets: [
    { id: "r", name: "Refeição", balance: 412, monthly_amount: 900, day: 5, daily_allowance: 20, next_recharge: "2026-12-05", runs_out_on: "2026-11-24", is_default: true, allow_negative: false, initial_balance: 0 },
    { id: "a", name: "Alimentação", balance: 228, monthly_amount: 600, day: 5, daily_allowance: 10, next_recharge: "2026-12-05", runs_out_on: null, is_default: false, allow_negative: false, initial_balance: 0 },
  ] });
  const tiles = benefitTiles([multi, account("vr", "beneficio", 50)]);
  expect(tiles.map((t) => [t.name, t.cents, t.left === null ? null : Math.round(t.left * 100), t.runsOut])).toEqual([
    ["Refeição", 41200, 46, "2026-11-24"], ["Alimentação", 22800, 38, null], ["vr", 5000, null, null],
  ]);
});

it("puts the default card in the middle of the carousel", () => {
  const order = carouselOrder([card("a"), card("b"), card("c", { is_default: true }), card("d"), card("e")]);
  expect(order.map((x) => x.id)).toEqual(["a", "b", "c", "d", "e"].filter((x) => x !== "c").slice(0, 2).concat("c", ["d", "e"]));
  expect(carouselOrder([card("a"), card("b", { is_default: true })]).map((x) => x.id)).toEqual(["b", "a"]);
});
