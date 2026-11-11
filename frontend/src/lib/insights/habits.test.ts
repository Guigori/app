import { describe, expect, it } from "vitest";
import { incomeReading, lastMonths, spendingHabits } from "@/lib/insights/habits";
import type { DayFlow, FlowPoint } from "@/types/finnos";

const day = (date: string, expense: number, income = 0): DayFlow => ({ date, expense, income, projected_income: 0, projected_expense: 0, count: 1, active_count: 1 });

describe("spendingHabits", () => {
  // 2026-11-06 is a Friday, 2026-11-08 a Sunday.
  const days = [day("2026-11-02", 100), day("2026-11-03", 0), day("2026-11-06", 300), day("2026-11-08", 100), day("2026-11-20", 999)];
  const h = spendingHabits(days, "2026-11-10");
  it("reads only the days that already happened", () => {
    expect(h.total).toBe(500);
    expect(h.daysSoFar).toBe(4);
    expect(h.quietDays).toBe(1);
    expect(h.peak).toEqual({ date: "2026-11-06", expense: 300 });
  });
  it("finds the most expensive weekday and the weekend share", () => {
    expect(h.topWeekday?.weekday).toBe(5);
    expect(h.weekendShare).toBeCloseTo(0.8);
  });
});

describe("incomeReading", () => {
  it("adds what is still expected to what was received", () => {
    const r = incomeReading(3000, 2000, [
      { date: "2026-11-20", name: "Freela", value: 1000, type: "receita", kind: "agendado" },
      { date: "2026-11-15", name: "Luz", value: 200, type: "despesa", kind: "fixa" },
    ]);
    expect(r).toMatchObject({ received: 3000, toCome: 1000, expected: 4000, committed: 0.5 });
    expect(r.next.map((n) => n.name)).toEqual(["Freela"]);
  });
});

describe("lastMonths", () => {
  const p = (month: string, income: number, expense: number): FlowPoint => ({ month, label: month, year: "", income, expense, net: income - expense, projected_income: 0, projected_expense: 0, projected_net: 0, future: month > "2026-11" });
  it("keeps the months up to the focus and averages the closed ones", () => {
    const r = lastMonths([p("2026-09", 5000, 4000), p("2026-10", 5000, 6000), p("2026-11", 1000, 500), p("2026-12", 0, 0)], "2026-11");
    expect(r.months.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(r.averageExpense).toBe(5000);
    expect(r.positive).toBe(1);
    expect(r.best?.month).toBe("2026-09");
    expect(r.worst?.month).toBe("2026-10");
    expect(r.current?.month).toBe("2026-11");
  });
});
