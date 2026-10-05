import { describe, expect, it } from "vitest";
import { buildMonthlyCumulativeRows, defaultDailyTooltipIndex, selectVisibleDailyRows } from "@/lib/homeChart";

describe("Home chart daily period logic", () => {
  const days = [
    { date: "2026-10-01", income: 1000, expense: 100, projected_income: 0, projected_expense: 0, count: 2, active_count: 2 },
    { date: "2026-10-03", income: 500, expense: 200, projected_income: 0, projected_expense: 0, count: 2, active_count: 2 },
    { date: "2026-10-05", income: 0, expense: 300, projected_income: 0, projected_expense: 0, count: 1, active_count: 1 },
  ];

  it("builds cumulative month totals by day", () => {
    const rows = buildMonthlyCumulativeRows("2026-10", days, "2026-10-05");
    expect(rows[0]).toMatchObject({ label: "01", Receitas: 1000, Despesas: 100, Resultado: 900 });
    expect(rows[2]).toMatchObject({ label: "03", Receitas: 1500, Despesas: 300, Resultado: 1200 });
    expect(rows[4]).toMatchObject({ label: "05", Receitas: 1500, Despesas: 600, Resultado: 900 });
  });

  it("does not expose future days for the current month", () => {
    const rows = buildMonthlyCumulativeRows("2026-10", days);
    const visible = selectVisibleDailyRows(rows, "2026-10", "1m", "2026-10-05");
    expect(visible).toHaveLength(31);
    expect(visible.at(-1)?.label).toBe("31");
  });

  it("keeps the complete selected month when it is not the current month", () => {
    const rows = buildMonthlyCumulativeRows("2026-09", [], "2026-10-05");
    const visible = selectVisibleDailyRows(rows, "2026-09", "1m", "2026-10-05");
    expect(visible).toHaveLength(30);
    expect(visible.at(-1)?.label).toBe("30");
  });

  it("limits the seven-day view to seven visible days ending at today", () => {
    const rows = buildMonthlyCumulativeRows("2026-10", days);
    const visible = selectVisibleDailyRows(rows, "2026-10", "7d", "2026-10-12");
    expect(visible.map((row) => row.label)).toEqual(["09", "10", "11", "12", "13", "14", "15"]);
  });

  it("focuses the default tooltip on today", () => {
    const rows = selectVisibleDailyRows(
      buildMonthlyCumulativeRows("2026-10", days, "2026-10-05"),
      "2026-10",
      "1m",
      "2026-10-05",
    );
    expect(defaultDailyTooltipIndex(rows, "2026-10", "2026-10-05")).toBe(4);
  });
});


it("includes scheduled future values without hiding future dates", () => {
  const rows = buildMonthlyCumulativeRows(
    "2026-10",
    [{ date: "2026-10-08", income: 0, expense: 0, projected_income: 0, projected_expense: 250, count: 1, active_count: 1 }],
    "2026-10-05",
  );
  expect(rows[7]).toMatchObject({ label: "08", Despesas: 250, Resultado: -250 });
});
