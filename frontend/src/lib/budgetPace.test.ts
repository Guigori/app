import { expect, it } from "vitest";
import { spendingPace } from "./budgetPace";

it("matches FINN cumulative spending, daily allowance and forecast for a 31-day month", () => {
  const pace = spendingPace(620, [
    { date: "2026-10-05", amount: 150 },
    { date: "2026-10-15", amount: 100 },
    { date: "2026-10-29", amount: 75 },
  ], "2026-10", "2026-10-20");
  expect(pace.pace_day).toBe(20);
  expect(pace.pace_ideal).toBe(400);
  expect(pace.pace_daily_allowance).toBe(33.63);
  expect(pace.pace_projected_close).toBe(387.50);
  expect(pace.pace_difference).toBe(150);
  expect(pace.pace_cumulative[20]).toBe(250);
});

it("does not treat future dates as realised spending", () => {
  const pace = spendingPace(100, [{ date: "2026-12-05", amount: 80 }], "2026-12", "2026-10-26");
  expect(pace.pace_day).toBe(0);
  expect(pace.pace_cumulative.at(-1)).toBe(0);
  expect(pace.pace_daily_allowance).toBe(3.22);
});

it("respects February and end-of-month day clamping", () => {
  const pace = spendingPace(100, [{ date: "2026-01-31", amount: 40 }], "2026-02", "2026-02-28");
  expect(pace.pace_days_in_month).toBe(28);
  expect(pace.pace_cumulative[28]).toBe(40);
  expect(pace.pace_daily_allowance).toBe(0);
});
