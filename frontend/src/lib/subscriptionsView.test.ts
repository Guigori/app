import { describe, expect, it } from "vitest";
import { monthlyCost, nextMonthlyDate, subscriptionsByCard, upcomingCharges, whenLabel } from "./subscriptionsView";
import { sortSignals } from "./radarUi";
import type { RadarSignal, SubscriptionItem } from "@/types/finnos";

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
