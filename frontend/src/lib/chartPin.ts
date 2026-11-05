import { todayISO } from "@/lib/format";

/**
 * Where a chart's tooltip sits before anyone touches it: on the row for "now" (today, or this month),
 * else on the last row. Charts pass it as `defaultIndex` together with `active`, so the tooltip is
 * always on screen and stays on the last point touched.
 */
export function pinIndex<T>(rows: readonly T[], isNow: (row: T) => boolean): number | undefined {
  if (rows.length === 0) return undefined;
  const index = rows.findIndex(isNow);
  return index >= 0 ? index : rows.length - 1;
}

/** Rows keyed by month ("YYYY-MM"): the current month. */
export const isThisMonth = (row: { month?: string }, today = todayISO()) => row.month === today.slice(0, 7);
