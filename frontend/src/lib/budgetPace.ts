/** Adapted from FINN analytics.ts::pace, but uses FINNOS paid-status rules.
 * Values are integer cents internally to avoid floating point drift.
 */
export interface SpendingPace {
  pace_day: number;
  pace_days_in_month: number;
  pace_ideal: number;
  pace_daily_allowance: number;
  pace_projected_close: number;
  pace_difference: number;
  pace_cumulative: number[];
}

export function spendingPace(
  limit: number,
  events: { date: string; amount: number }[],
  month: string,
  today: string,
): SpendingPace {
  const [year, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const day = today.slice(0, 7) < month ? 0 : today.slice(0, 7) > month ? days : Math.min(Number(today.slice(8)), days);
  const daily = Array<number>(days + 1).fill(0);
  for (const event of events) {
    const slot = Math.min(Number(event.date.slice(8)), days);
    const effective = `${month}-${String(slot).padStart(2, "0")}`;
    if (effective > today || !Number.isFinite(event.amount)) continue;
    daily[slot] += Math.round(event.amount * 100);
  }
  for (let i = 1; i <= days; i++) daily[i] += daily[i - 1];
  const limitCents = Math.round(limit * 100);
  const spent = daily[day];
  const available = Math.max(0, limitCents - spent);
  const ideal = Math.floor((limitCents * day + Math.floor(days / 2)) / days);
  const remainDays = days - day;
  return {
    pace_day: day,
    pace_days_in_month: days,
    pace_ideal: ideal / 100,
    pace_daily_allowance: (remainDays ? Math.floor(available / remainDays) : 0) / 100,
    pace_projected_close: (day ? Math.floor((spent * days + Math.floor(day / 2)) / day) : 0) / 100,
    pace_difference: (ideal - spent) / 100,
    pace_cumulative: daily.map(value => value / 100),
  };
}
