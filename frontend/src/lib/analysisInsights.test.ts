import { describe, expect, it } from "vitest";
import type { DayFlow, Transaction } from "@/types/finnos";
import { categoryChanges, commitments, evolution, monthPortion, rhythm, savingsRate, weekdayAverages } from "./analysisInsights";

const day = (date: string, expense: number): DayFlow => ({ date, income: 0, expense, projected_income: 0, projected_expense: 0, count: 1, active_count: 1 });
const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t", name: "Item", value: 100, type: "despesa", status: "pago", date: "2026-09-10", account_id: "a", account_name: "A",
  card_id: null, card_name: null, to_account_id: null, to_account_name: null, category_id: null, category_name: null,
  category_color: null, category_icon: null, fixed: false, recurrence: null, installment: false, total_installments: null,
  current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null, created_at: "", ...over,
});

describe("savingsRate and evolution", () => {
  it("computes the share of income kept", () => {
    expect(savingsRate(5000, 4000)).toBe(20);
    expect(savingsRate(0, 100)).toBeNull();
  });
  it("averages only months with movement and finds best/worst", () => {
    const out = evolution([
      { month: "2026-08", label: "ago", income: 0, expense: 0, net: 0 },
      { month: "2026-09", label: "set", income: 4000, expense: 3000, net: 1000 },
      { month: "2026-10", label: "out", income: 4000, expense: 4500, net: -500 },
    ]);
    expect(out).toMatchObject({ avgIncome: 4000, avgExpense: 3750, avgRate: 6.3 });
    expect(out.best?.month).toBe("2026-09");
    expect(out.worst?.month).toBe("2026-10");
    expect(out.months.map((m) => m.cumulative)).toEqual([0, 1000, 500]);
  });
});

describe("categoryChanges", () => {
  it("compares with last month, including new and gone categories", () => {
    const out = categoryChanges(
      [{ category_id: "m", name: "Mercado", color: "#0f0", icon: "x", total: 600, percent: 60 }, { category_id: "n", name: "Novo", color: "#00f", icon: "x", total: 100, percent: 10 }],
      [{ category_id: "m", name: "Mercado", color: "#0f0", icon: "x", total: 500, percent: 50 }, { category_id: "g", name: "Some", color: "#f00", icon: "x", total: 50, percent: 5 }],
    );
    expect(out.map((c) => [c.name, c.delta, c.deltaPct])).toEqual([["Mercado", 100, 20], ["Novo", 100, null], ["Some", -50, -100]]);
  });
});

describe("rhythm", () => {
  it("projects the month end at the current pace", () => {
    const out = rhythm("2026-11", [day("2026-11-01", 100), day("2026-11-03", 200), day("2026-11-20", 999)], [day("2026-10-02", 50)], "2026-11-04");
    expect(out).toMatchObject({ spent: 300, daysElapsed: 4, dailyAverage: 75, projection: 2250 });
    expect(out.curve[3]).toEqual({ day: 4, current: 300, previous: 50 });
    expect(out.curve[10].current).toBeNull();
  });
});

describe("weekdayAverages", () => {
  it("averages spending per weekday up to today", () => {
    const out = weekdayAverages([day("2026-11-02", 100), day("2026-11-09", 300), day("2026-11-30", 900)], "2026-11-10");
    expect(out[1]).toEqual({ label: "Seg", total: 400, average: 200 });
  });
});

describe("monthPortion and commitments", () => {
  it("spreads installments one per month", () => {
    const t = tx({ installment: true, total_installments: 3, current_installment: 1, installment_value: 200, value: 600 });
    expect(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"].map((m) => monthPortion(t, m))).toEqual([0, 200, 200, 200, 0]);
  });
  it("adds installments and fixed costs for the next months", () => {
    const out = commitments([
      tx({ name: "Notebook", installment: true, total_installments: 3, current_installment: 1, installment_value: 200, value: 600, date: "2026-10-05" }),
      tx({ name: "Aluguel", fixed: true, recurrence: "mensal", value: 1500, date: "2026-10-05" }),
      tx({ name: "Aluguel", fixed: true, recurrence: "mensal", value: 1600, date: "2026-11-05" }),
    ], [], "2026-11", 3);
    expect(out.fixedMonthly).toBe(1600);
    expect(out.months.map((m) => [m.month, m.installments, m.total])).toEqual([["2026-11", 200, 1800], ["2026-12", 200, 1800], ["2027-01", 0, 1600]]);
    expect(out.installmentItems).toEqual([{ name: "Notebook", value: 200, remaining: 2 }]);
  });
});
