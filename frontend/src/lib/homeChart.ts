import type { DayFlow } from "@/types/finnos";

export type DailyChartRow = {
  date: string;
  label: string;
  Receitas: number;
  Despesas: number;
  Resultado: number;
};

export function buildMonthlyCumulativeRows(month: string, days: DayFlow[], today?: string): DailyChartRow[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const byDate = new Map(days.map((day) => [day.date, day]));
  let cumulativeIncome = 0;
  let cumulativeExpense = 0;

  return Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const date = `${month}-${String(dayNumber).padStart(2, "0")}`;
    const day = byDate.get(date);
    cumulativeIncome += day?.income ?? 0;
    cumulativeExpense += day?.expense ?? 0;
    if (today && date > today) {
      cumulativeIncome += day?.projected_income ?? 0;
      cumulativeExpense += day?.projected_expense ?? 0;
    }
    return {
      date,
      label: String(dayNumber).padStart(2, "0"),
      Receitas: Math.round(cumulativeIncome * 100) / 100,
      Despesas: Math.round(cumulativeExpense * 100) / 100,
      Resultado: Math.round((cumulativeIncome - cumulativeExpense) * 100) / 100,
    };
  });
}

export function selectVisibleDailyRows(
  rows: DailyChartRow[],
  month: string,
  period: "7d" | "1m",
  today: string,
): DailyChartRow[] {
  if (period === "1m") return rows;

  if (month !== today.slice(0, 7)) {
    return rows.slice(Math.max(0, rows.length - 7));
  }

  const currentIndex = Math.min(Math.max(Number(today.slice(8, 10)) - 1, 0), Math.max(rows.length - 1, 0));
  const start = Math.max(0, Math.min(currentIndex - 3, Math.max(rows.length - 7, 0)));
  return rows.slice(start, start + 7);
}

export function defaultDailyTooltipIndex(rows: Array<{ label: string }>, month: string, today: string): number | undefined {
  if (rows.length === 0) return undefined;
  if (today.slice(0, 7) !== month) return rows.length - 1;
  const todayLabel = today.slice(8, 10);
  const index = rows.findIndex((item) => item.label === todayLabel);
  return index >= 0 ? index : rows.length - 1;
}
