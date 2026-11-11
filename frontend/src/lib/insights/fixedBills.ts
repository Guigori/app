/** Fixed bills in a period: which were paid, which are still to pay and which are late. */
import type { Transaction } from "@/types/finnos";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type FixedBillState = "pago" | "atrasado" | "a pagar";
export interface FixedBill { tx: Transaction; state: FixedBillState; value: number; day: number }

export interface FixedBillsReading {
  bills: FixedBill[];
  total: number;
  paidTotal: number;
  dueTotal: number;
  paidCount: number;
  lateCount: number;
  /** Due days of the period with how many bills fall on them and how many are paid. */
  days: Array<{ date: string; count: number; paid: number }>;
  next: FixedBill | null;
}

export const isFixedBill = (t: Transaction) => t.type === "despesa" && (t.fixed || Boolean(t.recurrence)) && !t.installment;

export function readFixedBills(transactions: Transaction[], start: string, end: string, today: string): FixedBillsReading {
  const bills = transactions
    .filter((t) => isFixedBill(t) && t.date >= start && t.date <= end)
    .map((t) => ({
      tx: t,
      value: round2(t.adjusted_value ?? t.value),
      day: Number(t.date.slice(8, 10)),
      state: (t.status === "pago" ? "pago" : t.date < today ? "atrasado" : "a pagar") as FixedBillState,
    }))
    // Late first, then what is still to pay by date, then what is paid.
    .sort((a, b) => ({ atrasado: 0, "a pagar": 1, pago: 2 })[a.state] - ({ atrasado: 0, "a pagar": 1, pago: 2 })[b.state] || a.tx.date.localeCompare(b.tx.date) || b.value - a.value);
  const days = new Map<string, { date: string; count: number; paid: number }>();
  for (const b of bills) {
    const d = days.get(b.tx.date) ?? { date: b.tx.date, count: 0, paid: 0 };
    d.count += 1; if (b.state === "pago") d.paid += 1;
    days.set(b.tx.date, d);
  }
  const paid = bills.filter((b) => b.state === "pago");
  return {
    bills,
    total: round2(bills.reduce((s, b) => s + b.value, 0)),
    paidTotal: round2(paid.reduce((s, b) => s + b.value, 0)),
    dueTotal: round2(bills.filter((b) => b.state !== "pago").reduce((s, b) => s + b.value, 0)),
    paidCount: paid.length,
    lateCount: bills.filter((b) => b.state === "atrasado").length,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    next: bills.find((b) => b.state === "a pagar") ?? null,
  };
}

/** First and last day of a month, as the transaction filters expect them. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  return { start: `${month}-01`, end: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` };
}
