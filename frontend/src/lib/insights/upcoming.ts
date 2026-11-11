/** What is coming: the next invoices to pay (and whether the account covers them) and the next 7 days. */
import type { Account, CreditCard, PlannedCharge, Transaction } from "@/types/finnos";

const round2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000);

export interface NextInvoice {
  cardId: string;
  cardName: string;
  color: string;
  amount: number;
  due: string;
  /** Closed invoice waiting for payment (otherwise the open one, still taking purchases). */
  closed: boolean;
  days: number;
  accountId: string | null;
  accountName: string | null;
  /** Balance of the paying account before this invoice (after the ones due earlier from it). */
  balanceBefore: number | null;
  covers: boolean | null;
  shortfall: number;
}

/** Per active card, the invoice that will be paid next; sorted by due date, with the paying account's cover. */
export function nextInvoices(cards: CreditCard[], accounts: Account[], today: string): NextInvoice[] {
  const rows = cards.filter((c) => c.active).flatMap((c) => {
    const closed = Boolean(c.payable_cycle && c.payable_cycle !== c.next_closing && (c.payable_invoice ?? 0) > 0 && c.payable_due);
    const amount = round2(closed ? c.payable_invoice ?? 0 : c.invoice_paid ? 0 : c.current_invoice);
    const due = closed ? c.payable_due! : c.next_due;
    if (amount <= 0) return [];
    return [{ c, amount, due, closed }];
  }).sort((a, b) => a.due.localeCompare(b.due));
  const left = new Map(accounts.map((a) => [a.id, a.balance]));
  return rows.map(({ c, amount, due, closed }) => {
    const account = accounts.find((a) => a.id === c.payment_account_id) ?? null;
    const before = account ? round2(left.get(account.id) ?? account.balance) : null;
    if (account) left.set(account.id, round2((before ?? 0) - amount));
    return {
      cardId: c.id, cardName: c.name, color: c.color, amount, due, closed, days: daysBetween(today, due),
      accountId: account?.id ?? null, accountName: account?.name ?? c.payment_account_name ?? null,
      balanceBefore: before, covers: before == null ? null : before >= amount, shortfall: before == null ? 0 : round2(Math.max(0, amount - before)),
    };
  });
}

export type WeekItemKind = "conta" | "fatura" | "assinatura" | "entrada";
export interface WeekItem { date: string; name: string; value: number; kind: WeekItemKind; where: string; id: string; tx?: Transaction }
export interface WeekAhead { items: WeekItem[]; days: Array<{ date: string; items: WeekItem[]; total: number }>; out: number; income: number; heaviest: { date: string; total: number } | null }

/**
 * The next `days` days (today included): scheduled bills from the bank, invoices due and subscriptions charged
 * outside a card. Card purchases and card subscriptions are left out: they are paid inside the invoice.
 */
export function weekAhead(transactions: Transaction[], invoices: NextInvoice[], planned: PlannedCharge[], today: string, days = 7): WeekAhead {
  const end = addDays(today, days - 1);
  const inside = (d: string) => d >= today && d <= end;
  const items: WeekItem[] = [];
  const names = new Set<string>();
  for (const t of transactions) {
    if (t.status === "pago" || !inside(t.date) || t.type === "transferencia" || t.card_id) continue;
    names.add(`${t.date}:${t.name.toLocaleLowerCase("pt-BR")}`);
    items.push({ id: t.id, date: t.date, name: t.name, value: round2(t.adjusted_value ?? t.value), kind: t.type === "receita" ? "entrada" : "conta", where: t.account_name ?? "", tx: t });
  }
  for (const i of invoices) if (inside(i.due)) items.push({ id: `fatura-${i.cardId}`, date: i.due, name: `Fatura ${i.cardName}`, value: i.amount, kind: "fatura", where: i.accountName ?? "" });
  for (const p of planned) {
    // A plan already registered as a lançamento that day is not counted twice.
    if (p.card_id || !inside(p.date) || names.has(`${p.date}:${p.name.toLocaleLowerCase("pt-BR")}`)) continue;
    items.push({ id: `assinatura-${p.subscription_id}-${p.date}`, date: p.date, name: p.name, value: round2(p.value), kind: "assinatura", where: "" });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || b.value - a.value);
  const byDay = new Map<string, WeekItem[]>();
  for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);
  const grouped = [...byDay.entries()].map(([date, list]) => ({ date, items: list, total: round2(list.filter((i) => i.kind !== "entrada").reduce((s, i) => s + i.value, 0)) }));
  const heaviest = [...grouped].sort((a, b) => b.total - a.total)[0];
  return {
    items,
    days: grouped,
    out: round2(items.filter((i) => i.kind !== "entrada").reduce((s, i) => s + i.value, 0)),
    income: round2(items.filter((i) => i.kind === "entrada").reduce((s, i) => s + i.value, 0)),
    heaviest: heaviest && heaviest.total > 0 ? { date: heaviest.date, total: heaviest.total } : null,
  };
}
