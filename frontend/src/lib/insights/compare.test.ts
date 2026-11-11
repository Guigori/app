import { describe, expect, it } from "vitest";
import { compare, expenseUntilDay } from "./compare";

describe("compare", () => {
  it("knows when a lower spending is good news", () => {
    expect(compare(80, 100, "lower")).toMatchObject({ delta: -20, pct: -0.2, better: true });
    expect(compare(120, 100, "lower")).toMatchObject({ delta: 20, better: false });
    expect(compare(120, 100, "higher")).toMatchObject({ better: true });
    expect(compare(100, 100, "lower")).toMatchObject({ same: true, better: null });
    expect(compare(10, 0, "lower")?.pct).toBeNull();
    expect(compare(10, null, "lower")).toBeNull();
  });
  it("adds the month up to the same day", () => {
    expect(expenseUntilDay([{ date: "2026-10-01", expense: 10 }, { date: "2026-10-10", expense: 5 }, { date: "2026-10-11", expense: 99 }], 10)).toBe(15);
  });
});
