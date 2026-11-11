/** Invoice analysis: last, current and next invoices of one card or of all cards together. Values in BRL. */
import { addMonth } from "@/lib/format";
import type { CreditCard, Invoice, InvoiceItem } from "@/types/finnos";

const round2 = (n: number) => Math.round(n * 100) / 100;
const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); };

/** The closing date that identifies a card's invoice in a month (the cycle the API expects). */
export function closingForMonth(card: Pick<CreditCard, "closing_day">, month: string): string {
  return `${month}-${String(Math.min(card.closing_day, lastDay(month))).padStart(2, "0")}`;
}

/** The month of the invoice that is open now (still taking purchases). */
export function currentInvoiceMonth(card: Pick<CreditCard, "next_closing">): string {
  return card.next_closing.slice(0, 7);
}

/** Offsets analysed by default: the last invoice, the current one and the next two. */
export const INVOICE_OFFSETS = [-1, 0, 1, 2] as const;

export interface InvoicePoint {
  /** -1 last, 0 current, 1.. next. */
  offset: number;
  month: string;
  total: number;
  paidAmount: number;
  paid: boolean;
  dueDate: string | null;
  items: InvoiceItem[];
}

export function invoicePoint(offset: number, invoice: Invoice): InvoicePoint {
  return {
    offset,
    month: invoice.cycle_end.slice(0, 7),
    total: round2(invoice.total),
    paidAmount: round2(invoice.paid_amount),
    paid: invoice.paid,
    dueDate: invoice.due_date,
    items: invoice.items,
  };
}

/** All cards together: invoices are summed by their position (last, current, next…). */
export function mergeInvoicePoints(perCard: InvoicePoint[][]): InvoicePoint[] {
  const byOffset = new Map<number, InvoicePoint>();
  for (const points of perCard) {
    for (const p of points) {
      const seen = byOffset.get(p.offset);
      if (!seen) { byOffset.set(p.offset, { ...p, items: [...p.items] }); continue; }
      seen.total = round2(seen.total + p.total);
      seen.paidAmount = round2(seen.paidAmount + p.paidAmount);
      seen.paid = seen.paid && (p.paid || p.total === 0);
      seen.items.push(...p.items);
      if (p.dueDate && (!seen.dueDate || p.dueDate < seen.dueDate)) seen.dueDate = p.dueDate;
    }
  }
  return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
}

export type FindingTone = "good" | "bad" | "info";
export interface Finding { tone: FindingTone; text: string }

export interface InvoiceReading {
  past: InvoicePoint | null;
  present: InvoicePoint | null;
  future: InvoicePoint[];
  change: number | null;
  changePct: number | null;
  futureTotal: number;
  installmentsInPresent: number;
  topCategory: { name: string; color: string | null; total: number; share: number } | null;
  biggest: InvoiceItem | null;
  findings: Finding[];
}

const shortMonth = (month: string) => {
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return names[Number(month.slice(5, 7)) - 1] ?? month;
};

/** What the invoices say: how the current one compares, what is already booked ahead, what weighs most. */
export function readInvoices(points: InvoicePoint[], money: (v: number) => string, today: string, options: { overdue?: boolean; labels?: boolean } = {}): InvoiceReading {
  const { overdue = true, labels = true } = options;
  const past = points.find((p) => p.offset === -1) ?? null;
  const present = points.find((p) => p.offset === 0) ?? null;
  const future = points.filter((p) => p.offset > 0);
  const findings: Finding[] = [];
  const change = past && present ? round2(present.total - past.total) : null;
  const changePct = change != null && past && past.total > 0 ? change / past.total : null;
  const futureTotal = round2(future.reduce((s, p) => s + p.total, 0));
  const installmentsInPresent = round2((present?.items ?? []).filter((i) => i.installment_label).reduce((s, i) => s + i.value, 0));

  const cats = new Map<string, { name: string; color: string | null; total: number }>();
  for (const item of present?.items ?? []) {
    const k = item.category_name ?? "Sem categoria";
    const e = cats.get(k) ?? { name: k, color: item.category_color, total: 0 };
    e.total = round2(e.total + item.value);
    cats.set(k, e);
  }
  const top = [...cats.values()].sort((a, b) => b.total - a.total)[0];
  const topCategory = top && present && present.total > 0 ? { ...top, share: top.total / present.total } : null;
  const biggest = [...(present?.items ?? [])].sort((a, b) => b.value - a.value)[0] ?? null;

  if (overdue && past && past.total > 0 && !past.paid && past.dueDate && past.dueDate < today) {
    findings.push({ tone: "bad", text: `A fatura de ${shortMonth(past.month)} venceu e ainda falta pagar ${money(round2(past.total - past.paidAmount))}.` });
  }
  if (change != null && past && past.total > 0 && Math.abs(change) >= 0.01) {
    findings.push(change > 0
      ? { tone: "bad", text: `A fatura atual já está ${money(change)} acima da ${labels ? `de ${shortMonth(past.month)}` : "passada"}${changePct != null ? ` (+${Math.round(changePct * 100)}%)` : ""}.` }
      : { tone: "good", text: `A fatura atual está ${money(-change)} abaixo da ${labels ? `de ${shortMonth(past.month)}` : "passada"}.` });
  }
  if (present && installmentsInPresent > 0) {
    findings.push({ tone: "info", text: `${money(installmentsInPresent)} da fatura atual são parcelas (${Math.round((installmentsInPresent / Math.max(present.total, 0.01)) * 100)}%).` });
  }
  if (topCategory && cats.size > 1) {
    findings.push({ tone: "info", text: `${topCategory.name} é o que mais pesa: ${money(topCategory.total)}, ${Math.round(topCategory.share * 100)}% da fatura.` });
  }
  const next = future[0];
  if (next && next.total > 0) {
    findings.push({ tone: "info", text: `${labels ? shortMonth(next.month).replace(/^./, (c) => c.toUpperCase()) : "A próxima fatura"} já começa com ${money(next.total)} lançados${future.length > 1 ? ` · ${money(futureTotal)} nos próximos ${future.length} meses` : ""}.` });
  } else if (next) {
    findings.push({ tone: "good", text: `Nada lançado ainda para ${labels ? shortMonth(next.month) : "a próxima fatura"}.` });
  }
  return { past, present, future, change, changePct, futureTotal, installmentsInPresent, topCategory, biggest, findings };
}

/** Months of the default window for a card, from its current invoice. */
export function invoiceMonths(card: Pick<CreditCard, "next_closing">): Array<{ offset: number; month: string }> {
  const base = currentInvoiceMonth(card);
  return INVOICE_OFFSETS.map((offset) => ({ offset, month: addMonth(base, offset) }));
}

/** Overdue last invoice of one card, said with the card's name when several cards are read together. */
export function overdueFinding(cardName: string | null, past: InvoicePoint | undefined, money: (v: number) => string, today: string): Finding | null {
  if (!past || past.total <= 0 || past.paid || !past.dueDate || past.dueDate >= today) return null;
  return { tone: "bad", text: `${cardName ? `${cardName}: a` : "A"} fatura de ${shortMonth(past.month)} venceu e ainda falta pagar ${money(round2(past.total - past.paidAmount))}.` };
}
