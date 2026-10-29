import { expect, it } from "vitest";
import type { SubscriptionItem, Transaction } from "@/types/finnos";
import { localSubscriptionProjections } from "./subscriptionProjection";

function subscription(overrides: Partial<SubscriptionItem> = {}): SubscriptionItem {
  return {
    id: "s1", name: "Netflix", value: 49.9,
    category_id: "streaming", category_name: null,
    category_color: null, account_id: "bank", account_name: "",
    card_id: null, card_name: null, recurrence: "mensal",
    next_charge: "2026-01-31", active: true, notes: null,
    ...overrides,
  };
}
function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx", name: "NETFLIX", value: 49.9,
    type: "despesa", status: "agendado", date: "2026-02-28",
    category_id: "streaming", category_name: null, category_color: null,
    category_icon: null, account_id: "bank", account_name: "",
    card_id: null, card_name: null,
    to_account_id: null, to_account_name: null,
    fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null,
    installment_value: null, adjusted_value: null, attachment: null,
    notes: null, created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

it("clamps a January 31 billing anchor in February without changing March", () => {
  const subs = [subscription()];
  expect(localSubscriptionProjections(subs, [], "2026-02", "2026-02-01")[0]?.date)
    .toBe("2026-02-28");
  expect(localSubscriptionProjections(subs, [], "2026-03", "2026-03-01")[0]?.date)
    .toBe("2026-03-31");
  expect(subs[0].next_charge).toBe("2026-01-31");
});

it("avoids double counting existing bills and fixed monthly transactions", () => {
  expect(localSubscriptionProjections([subscription()], [transaction()],
    "2026-02", "2026-02-01")).toEqual([]);
  expect(localSubscriptionProjections([subscription()], [transaction({ fixed: true })],
    "2026-03", "2026-03-01")).toEqual([]);
  expect(localSubscriptionProjections([subscription()], [transaction()],
    "2026-03", "2026-03-01")).toHaveLength(1);
});

it("plans annual charges only on anniversaries, never for inactive subscriptions", () => {
  const subs = [subscription({ recurrence: "anual", next_charge: "2026-02-28" })];
  expect(localSubscriptionProjections(subs, [], "2026-03", "2026-03-01")).toEqual([]);
  expect(localSubscriptionProjections(subs, [], "2027-02", "2027-02-01")).toHaveLength(1);
  expect(localSubscriptionProjections([subscription({ active: false })], [],
    "2026-03", "2026-03-01")).toEqual([]);
});

it("never rewrites previous recurring charges as paid bank transactions", () => {
  expect(localSubscriptionProjections([subscription()], [], "2026-02", "2026-03-01")).toEqual([]);
});
