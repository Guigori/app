/** "Previsão de saldo": the money in the accounts day by day, real up to today and expected until the end of the month. */
import type { BalanceHistory, PlannedCharge, Transaction } from "@/types/finnos";
import type { NextInvoice } from "@/lib/insights/upcoming";

const round2 = (n: number) => Math.round(n * 100) / 100;
const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); };

export interface ForecastPoint { date: string; value: number; kind: "real" | "previsto" }
export interface ForecastEvent { date: string; name: string; value: number }
export interface BalanceForecast {
  today: number;
  end: number;
  change: number;
  incoming: number;
  outgoing: number;
  lowest: ForecastPoint | null;
  firstNegative: string | null;
  series: ForecastPoint[];
  events: ForecastEvent[];
}

/**
 * Same rule as "Saldo total": card purchases leave the bank when the invoice is paid, so they enter as the invoice
 * due date; scheduled bank lançamentos and subscriptions charged outside a card enter on their own day.
 */
export function balanceForecast(history: BalanceHistory, transactions: Transaction[], invoices: NextInvoice[], planned: PlannedCharge[], today: string): BalanceForecast {
  const month = history.month;
  const end = `${month}-${String(lastDay(month)).padStart(2, "0")}`;
  const events: ForecastEvent[] = [];
  const names = new Set<string>();
  for (const t of transactions) {
    if (t.status === "pago" || t.card_id || t.type === "transferencia" || t.date < today || t.date > end) continue;
    names.add(`${t.date}:${t.name.toLocaleLowerCase("pt-BR")}`);
    const v = round2(t.adjusted_value ?? t.value);
    events.push({ date: t.date, name: t.name, value: t.type === "receita" ? v : -v });
  }
  for (const i of invoices) if (i.due >= today && i.due <= end) events.push({ date: i.due, name: `Fatura ${i.cardName}`, value: -i.amount });
  for (const p of planned) {
    if (p.card_id || p.date < today || p.date > end || names.has(`${p.date}:${p.name.toLocaleLowerCase("pt-BR")}`)) continue;
    events.push({ date: p.date, name: p.name, value: -round2(p.value) });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value);

  const real: ForecastPoint[] = history.days.map((d) => ({ date: d.date, value: round2(d.balance), kind: "real" }));
  const start = round2(history.balance);
  let running = start;
  const future: ForecastPoint[] = [];
  const firstDay = Number(today.slice(8, 10));
  for (let day = firstDay; day <= lastDay(month); day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    running = round2(running + events.filter((e) => e.date === date).reduce((s, e) => s + e.value, 0));
    future.push({ date, value: running, kind: "previsto" });
  }
  // Today is the joint: the real point ends the solid line, the forecast starts from it.
  const series = [...real.filter((p) => p.date < today), { date: today, value: start, kind: "real" as const }, ...future.filter((p) => p.date > today)];
  const ahead = future;
  const lowest = ahead.length ? ahead.reduce((m, p) => (p.value < m.value ? p : m), ahead[0]) : null;
  return {
    today: start,
    end: future.at(-1)?.value ?? start,
    change: round2((future.at(-1)?.value ?? start) - start),
    incoming: round2(events.filter((e) => e.value > 0).reduce((s, e) => s + e.value, 0)),
    outgoing: round2(-events.filter((e) => e.value < 0).reduce((s, e) => s + e.value, 0)),
    lowest,
    firstNegative: future.find((p) => p.value < 0)?.date ?? null,
    series,
    events,
  };
}
