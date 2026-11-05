import { describe, expect, it } from "vitest";
import { fluxoSubscriptions, monthlyCost, plannedInView, seedFromTransaction, nextMonthlyDate, subscriptionsByCard, upcomingCharges, whenLabel } from "./subscriptionsView";
import { sortSignals } from "./radarUi";
import type { PlannedCharge, RadarSignal, SubscriptionItem, Transaction } from "@/types/finnos";

const sub = (over: Partial<SubscriptionItem>): SubscriptionItem => ({
  id: "s", name: "Serviço", value: 30, category_id: null, category_name: null, category_color: null,
  account_id: "a", account_name: "Conta", card_id: null, card_name: null, recurrence: "mensal",
  next_charge: "2026-11-10", active: true, ...over,
});

describe("subscriptions view", () => {
  it("spreads annual plans across the year", () => {
    expect(monthlyCost(sub({ value: 120, recurrence: "anual" }))).toBe(10);
    expect(monthlyCost(sub({ value: 30 }))).toBe(30);
  });

  it("lists active charges in the window, overdue first, paused ones never", () => {
    const rows = upcomingCharges([
      sub({ id: "late", next_charge: "2026-11-02" }),
      sub({ id: "soon", next_charge: "2026-11-05" }),
      sub({ id: "far", next_charge: "2027-01-20" }),
      sub({ id: "paused", next_charge: "2026-11-05", active: false }),
    ], "2026-11-04");
    expect(rows.map((r) => [r.item.id, r.days])).toEqual([["late", -2], ["soon", 1]]);
    expect(whenLabel(-2)).toBe("atrasada 2 dias");
    expect(whenLabel(1)).toBe("amanhã");
  });

  it("totals the monthly cost charged on each card", () => {
    const byCard = subscriptionsByCard([
      sub({ card_id: "c1", value: 20 }),
      sub({ card_id: "c1", value: 120, recurrence: "anual" }),
      sub({ card_id: "c1", value: 99, active: false }),
      sub({ card_id: null }),
    ]);
    expect(byCard.get("c1")).toEqual({ count: 2, monthly: 30 });
    expect(byCard.size).toBe(1);
  });

  it("projects the next monthly charge without skipping short months", () => {
    expect(nextMonthlyDate("2026-01-31", "2026-02-01")).toBe("2026-02-28");
    expect(nextMonthlyDate("2026-09-15", "2026-11-04")).toBe("2026-11-15");
  });
});

describe("radar order", () => {
  const signal = (id: string, severity: RadarSignal["severity"], score: number) =>
    ({ id, severity, score }) as RadarSignal;
  it("puts urgent signals first, then the highest score", () => {
    const sorted = sortSignals([signal("a", "normal", 99), signal("b", "critical", 10), signal("c", "high", 50), signal("d", "high", 80)]);
    expect(sorted.map((s) => s.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("subscriptions found in Fluxo", () => {
  const tx = (over: Partial<Transaction>) => ({
    id: "t", name: "Netflix", value: 44.9, installment_value: null, type: "despesa", date: "2026-10-12",
    account_id: "a", card_id: null, category_id: "c", category_name: "Assinaturas", category_color: "#f00", ...over,
  }) as Transaction;

  it("groups by name, keeps the latest charge and projects the next one", () => {
    const { onlyInFluxo, matched } = fluxoSubscriptions([
      tx({ id: "1", date: "2026-09-12", value: 39.9 }),
      tx({ id: "2", date: "2026-10-12" }),
      tx({ id: "3", name: "Mercado", category_name: "Alimentação" }),
      tx({ id: "4", name: "Salário", type: "receita" }),
    ], [], "2026-11-04");
    expect(matched.size).toBe(0);
    expect(onlyInFluxo).toHaveLength(1);
    expect(onlyInFluxo[0]).toMatchObject({ name: "Netflix", value: 44.9, count: 2, lastDate: "2026-10-12", nextCharge: "2026-11-12" });
  });

  it("links a Fluxo charge to the subscription with the same name instead of listing it twice", () => {
    const { onlyInFluxo, matched } = fluxoSubscriptions([tx({ name: "NETFLIX " })], [sub({ id: "s1", name: "Netflix" })], "2026-11-04");
    expect(onlyInFluxo).toHaveLength(0);
    expect(matched.get("s1")?.count).toBe(1);
  });

  it("uses a charge already scheduled in Fluxo as the next one", () => {
    expect(seedFromTransaction(tx({ date: "2026-11-12" }), "2026-11-04").next_charge).toBe("2026-11-12");
    expect(seedFromTransaction(tx({ date: "2026-10-12" }), "2026-11-04").next_charge).toBe("2026-11-12");
  });
});

describe("planned charges in Fluxo", () => {
  const charge = (over: Partial<PlannedCharge>): PlannedCharge => ({
    date: "2026-11-12", subscription_id: "s", name: "Netflix", value: 44.9, account_id: "a", card_id: null, category_id: null, ...over,
  });
  const all = { from: "2026-11-01", to: "2026-11-30", type: "todos", status: "todos", accountId: "todas", search: "" };
  const items = [charge({}), charge({ subscription_id: "t", name: "Spotify", date: "2026-11-20", account_id: "b" })];

  it("keeps the charges of the day or period on screen", () => {
    expect(plannedInView(items, { ...all, from: "2026-11-12", to: "2026-11-12" }).map((p) => p.name)).toEqual(["Netflix"]);
    expect(plannedInView(items, all)).toHaveLength(2);
  });

  it("follows the account, search, type and status filters", () => {
    expect(plannedInView(items, { ...all, accountId: "b" }).map((p) => p.name)).toEqual(["Spotify"]);
    expect(plannedInView(items, { ...all, search: "spoti" }).map((p) => p.name)).toEqual(["Spotify"]);
    expect(plannedInView(items, { ...all, type: "receita" })).toEqual([]);
    expect(plannedInView(items, { ...all, status: "pago" })).toEqual([]);
    expect(plannedInView(items, { ...all, status: "agendado" })).toHaveLength(2);
  });
});
