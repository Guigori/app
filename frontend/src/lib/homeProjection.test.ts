import { describe, expect, it } from "vitest";
import { buildProjectionRows, realDays } from "@/lib/homeProjection";
import type { BalanceHistory, DayFlow } from "@/types/finnos";

const flow = (date: string, over: Partial<DayFlow> = {}): DayFlow => ({
  date, income: 0, expense: 0, projected_income: 0, projected_expense: 0, count: 1, active_count: 1, ...over,
});

// October: salary on the 5th, a debit purchase on the 6th, a R$ 999 card purchase on the 7th
// (money leaves only when the invoice is paid, in November).
const OCTOBER: DayFlow[] = [
  flow("2026-10-05", { income: 5200 }),
  flow("2026-10-06", { expense: 120 }),
  flow("2026-10-07", { expense: 999 }),
];
const OCTOBER_CASH: BalanceHistory = {
  month: "2026-10",
  opening_balance: 1800,
  days: Array.from({ length: 31 }, (_, i) => {
    const day = i + 1;
    return { date: `2026-10-${String(day).padStart(2, "0")}`, balance: 1800 + (day >= 5 ? 5200 : 0) - (day >= 6 ? 120 : 0) };
  }),
  balance: 6880,
};

describe("Home projection chart", () => {
  it("counts the real days of past, current and future months", () => {
    expect(realDays("2026-10", "2026-11-10")).toBe(31);
    expect(realDays("2026-11", "2026-11-10")).toBe(10);
    expect(realDays("2026-12", "2026-11-10")).toBe(0);
  });

  it("draws Saldo from the account balance of each day, not from today's total", () => {
    // Today's total is different from October's end: November already moved money.
    const rows = buildProjectionRows({ month: "2026-10", days: OCTOBER, history: OCTOBER_CASH, total: 6000, today: "2026-11-10" });
    expect(rows[0].balanceActual).toBe(1800);
    expect(rows[4].balanceActual).toBe(7000);
    expect(rows[30].balanceActual).toBe(6880);
    // The card purchase is in Despesas on its day, but did not take money out of the account.
    expect(rows[6].expenseActual).toBe(1119);
    expect(rows[6].balanceActual).toBe(rows[5].balanceActual);
    expect(rows.every((row) => row.estimate === 0)).toBe(true);
  });

  it("continues today's balance with what is still expected", () => {
    const days = [flow("2026-11-05", { income: 100 }), flow("2026-11-20", { projected_expense: 1500 }), flow("2026-11-25", { projected_income: 5200 })];
    const history: BalanceHistory = {
      month: "2026-11", opening_balance: 13011.85,
      days: Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, balance: i >= 4 ? 13111.85 : 13011.85 })),
      balance: 13111.85,
    };
    const rows = buildProjectionRows({ month: "2026-11", days, history, total: 13111.85, today: "2026-11-10" });
    expect(rows[9]).toMatchObject({ balanceActual: 13111.85, balanceForecast: 13111.85, estimate: 0 });
    expect(rows[10]).toMatchObject({ balanceActual: null, balanceForecast: 13111.85, estimate: 1 });
    expect(rows[19].balanceForecast).toBe(11611.85);
    expect(rows[29].balanceForecast).toBe(16811.85);
    expect(rows[29].incomeForecast).toBe(5300);
  });

  it("estimates a future month from today's balance", () => {
    const history: BalanceHistory = { month: "2026-12", opening_balance: 13111.85, days: [], balance: 13111.85 };
    const rows = buildProjectionRows({ month: "2026-12", days: [flow("2026-12-10", { projected_expense: 111.85 })], history, total: 13111.85, today: "2026-11-10" });
    expect(rows[0].balanceForecast).toBe(13111.85);
    expect(rows[30].balanceForecast).toBe(13000);
    expect(rows.every((row) => row.balanceActual === null)).toBe(true);
  });

  it("without the history (older server), keeps the previous estimate", () => {
    const rows = buildProjectionRows({ month: "2026-11", days: [flow("2026-11-05", { income: 100 })], total: 1000, today: "2026-11-10" });
    expect(rows[0].balanceActual).toBe(900);
    expect(rows[9].balanceActual).toBe(1000);
  });
});
