/**
 * Orçamento · tela 5 (Fechar o mês). What happened in a month, from the Fluxo records and the limits, and the closing
 * snapshot the Orçamento keeps (lib/budget/server.ts). Read only over the other modules: checking an estimate or registering what is missing
 * opens the Fluxo form; keeping the sobra goes to Metas or becomes a transfer the person confirms in Fluxo.
 */
import type { Transaction } from "@/types/finnos";
import type { CategoryLimit } from "@/lib/budget/monthView";

export interface ClosingSummary {
  earned: number;
  spent: number;
  result: number;
  opening: number;
  closing: number;
  dailyPlanned: number;
  dailySpent: number;
  /** Estimates and scheduled records of the month still not paid: the person decides what happened. */
  open: Transaction[];
  /** Registered in the plan (fixed, scheduled, installments, incomes) and paid. */
  happened: Transaction[];
  /** Spending that was not in any plan (not fixed, not recurring), biggest first. */
  unplanned: Transaction[];
  categories: (CategoryLimit & { previous: number | null })[];
  insights: { id: string; question: string; answer: string; items: Transaction[] }[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const amount = (t: Transaction) => (t.installment ? t.installment_value ?? t.value : t.value);

export function buildClosing({ month, transactions, categories, previous, earned, spent, opening, closing }: {
  month: string; transactions: Transaction[]; categories: CategoryLimit[]; previous: Record<string, number>;
  earned: number; spent: number; opening: number; closing: number;
}): ClosingSummary {
  const inMonth = transactions.filter((t) => t.date.slice(0, 7) === month && t.type !== "transferencia" && !t.invoice_payment && !t.balance_adjustment);
  const open = inMonth.filter((t) => t.status !== "pago").sort((a, b) => a.date.localeCompare(b.date));
  const happened = inMonth.filter((t) => t.status === "pago" && (t.fixed || !!t.recurrence_id || t.installment || t.type === "receita"));
  const unplanned = inMonth.filter((t) => t.status === "pago" && t.type === "despesa" && !t.fixed && !t.recurrence_id && !t.installment).sort((a, b) => amount(b) - amount(a));
  const cats = categories.map((c) => ({ ...c, previous: previous[c.category_id] ?? null }));
  const dailyPlanned = r2(cats.reduce((s, c) => s + c.limit, 0));
  const dailySpent = r2(cats.reduce((s, c) => s + c.spent, 0));

  const insights: ClosingSummary["insights"] = [];
  const over = [...cats].filter((c) => c.over > 0).sort((a, b) => b.over - a.over)[0];
  if (over) {
    const its = unplanned.filter((t) => t.category_id === over.category_id).slice(0, 3);
    const top = its.reduce((s, t) => s + amount(t), 0);
    insights.push({ id: "over", question: `Por que ${over.name} passou?`, items: its,
      answer: `${over.name} fechou em ${fmt(over.spent)}, ${fmt(over.over)} acima do limite de ${fmt(over.limit)}.${its.length ? ` Os ${its.length} maiores gastos somam ${fmt(top)}.` : ""}${over.previous != null ? ` No mês anterior foram ${fmt(over.previous)}.` : ""}` });
  }
  const best = [...cats].filter((c) => c.spent < c.limit && c.spent > 0).sort((a, b) => (a.spent / a.limit) - (b.spent / b.limit))[0];
  if (best) insights.push({ id: "best", question: `${best.name} foi bem por quê?`, items: unplanned.filter((t) => t.category_id === best.category_id).slice(0, 3),
    answer: `${best.name} usou ${Math.round((best.spent / best.limit) * 100)}% do limite: ${fmt(best.spent)} de ${fmt(best.limit)}.${best.previous != null ? ` ${best.spent <= best.previous ? "Menos" : "Mais"} que no mês anterior (${fmt(best.previous)}).` : ""}` });
  if (open.length) insights.push({ id: "open", question: "O que não aconteceu?", items: open.slice(0, 4),
    answer: `${open.length} ${open.length === 1 ? "lançamento previsto ainda está aberto" : "lançamentos previstos ainda estão abertos"}, somando ${fmt(open.reduce((s, t) => s + amount(t), 0))}. Confira cada um no passo seguinte.` });

  return { earned: r2(earned), spent: r2(spent), result: r2(earned - spent), opening: r2(opening), closing: r2(closing), dailyPlanned, dailySpent, open, happened, unplanned, categories: cats, insights };
}

function fmt(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}


/** "Como fechou": the money of the accounts in a month that ended, from the opening balance to the closing one. */
export interface MonthFlow {
  opening: number;
  income: number;
  bills: number;
  invoices: number;
  daily: number;
  /** What the balances moved that is none of the above (adjustments, transfers to benefits…): keeps the account honest. */
  other: number;
  closing: number;
}

export function buildMonthFlow({ month, transactions, benefitIds, opening, closing }: {
  month: string; transactions: Transaction[]; benefitIds: Set<string>; opening: number; closing: number;
}): MonthFlow {
  const inMonth = transactions.filter((t) => t.date.slice(0, 7) === month && t.status === "pago" && !benefitIds.has(t.account_id) && !t.balance_adjustment);
  const income = r2(inMonth.filter((t) => t.type === "receita").reduce((s, t) => s + t.value, 0));
  const invoices = r2(inMonth.filter((t) => t.invoice_payment).reduce((s, t) => s + t.value, 0));
  const spending = inMonth.filter((t) => t.type === "despesa" && !t.card_id && !t.invoice_payment && !t.invoice_refund);
  const bills = r2(spending.filter((t) => t.fixed || !!t.recurrence_id || t.installment).reduce((s, t) => s + amount(t), 0));
  const daily = r2(spending.filter((t) => !(t.fixed || !!t.recurrence_id || t.installment)).reduce((s, t) => s + amount(t), 0));
  const other = r2(closing - (opening + income - bills - invoices - daily));
  return { opening: r2(opening), income, bills, invoices, daily, other, closing: r2(closing) };
}

export interface EstimateSuggestion { key: string; name: string; type: "receita" | "despesa"; value: number; day: number; months: number; category_id?: string | null; account_id?: string | null }

const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Passo 3 do fechamento: contas e receitas que se repetiram nos últimos meses mas não estão previstas no mês
 * seguinte (ex.: conta de luz, que muda de valor e não é fixa). Sugere a média; só vira estimativa se a pessoa
 * abrir e salvar no Fluxo.
 */
export function suggestEstimates({ history, months, expected }: { history: Transaction[]; months: string[]; expected: string[] }): EstimateSuggestion[] {
  const have = new Set(expected.map(normName));
  const by = new Map<string, { name: string; type: "receita" | "despesa"; values: Map<string, number>; days: number[]; category_id?: string | null; account_id?: string | null }>();
  for (const t of history) {
    const m = t.date.slice(0, 7);
    if (!months.includes(m) || t.status !== "pago" || t.fixed || t.recurrence_id || t.installment || t.card_id || t.invoice_payment || t.balance_adjustment || t.benefit_recharge) continue;
    if (t.type !== "receita" && t.type !== "despesa") continue;
    const k = `${t.type}|${normName(t.name)}`;
    const cur = by.get(k) ?? { name: t.name, type: t.type, values: new Map<string, number>(), days: [] as number[], category_id: t.category_id, account_id: t.account_id };
    cur.values.set(m, (cur.values.get(m) ?? 0) + t.value);
    cur.days.push(Number(t.date.slice(8)));
    by.set(k, cur);
  }
  return [...by.entries()]
    .filter(([, x]) => x.values.size >= 2 && !have.has(normName(x.name)))
    .map(([key, x]) => {
      const vals = [...x.values.values()];
      const days = [...x.days].sort((a, b) => a - b);
      return { key, name: x.name, type: x.type, value: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100, day: Math.min(28, days[Math.floor(days.length / 2)]), months: x.values.size, category_id: x.category_id, account_id: x.account_id };
    })
    .sort((a, b) => b.months - a.months || b.value - a.value)
    .slice(0, 8);
}
