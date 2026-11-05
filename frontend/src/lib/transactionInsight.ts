/** Pure helpers behind the lançamento detail: where the money went, its budget, its rhythm and its weight on the month. */
import type { BudgetAllocationProgress, BudgetCycleProgress, BudgetSummary, CalendarMonth, SubscriptionItem, Transaction } from "@/types/finnos";

const norm = (text: string) => text.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Positive for money in, negative for money out, zero for a move between own accounts. */
export function signedAmount(tx: Pick<Transaction, "type" | "value">): number {
  return tx.type === "receita" ? tx.value : tx.type === "despesa" ? -tx.value : 0;
}

export function flowPath(tx: Transaction): { from: string; to: string } {
  const source = tx.card_name ?? tx.account_name;
  if (tx.type === "transferencia") return { from: tx.account_name, to: tx.to_account_name ?? "Outra conta" };
  if (tx.type === "receita") return { from: tx.category_name ?? "Receita", to: tx.account_name };
  return { from: source, to: tx.category_name ?? "Sem categoria" };
}

export interface BudgetImpact {
  name: string;
  budget: number;
  spent: number;
  remaining: number;
  /** Share of the category limit used so far, 0–n. */
  used: number;
  /** Share of the limit this lançamento alone represents. */
  share: number;
  /** A scheduled or pending expense is not in `spent` yet: the figures count it as if paid. */
  counted: boolean;
  status: "dentro" | "proximo" | "acima";
}

/** The category limit this expense counts against, or null when it has none. */
export function budgetImpact(tx: Transaction, budget: BudgetSummary | null | undefined): BudgetImpact | null {
  if (tx.type !== "despesa" || !tx.category_id || !budget) return null;
  const row = budget.rows.find((r) => r.category_id === tx.category_id);
  if (!row || row.budget <= 0) return null;
  // The budget only counts paid expenses; a scheduled one shows where it will leave the limit.
  const counted = tx.status !== "pago";
  const spent = counted ? row.spent + tx.value : row.spent;
  const used = spent / row.budget;
  return {
    name: row.name, budget: row.budget, spent, remaining: row.budget - spent,
    used, share: tx.value / row.budget, counted,
    status: used > 1 ? "acima" : used >= 0.8 ? "proximo" : "dentro",
  };
}

export type Rhythm =
  | { kind: "parcela"; current: number; total: number; left: number }
  | { kind: "fixa"; recurrence: string }
  | { kind: "assinatura"; name: string }
  | { kind: "repete"; times: number; average: number }
  | { kind: "unica" };

/**
 * How this lançamento repeats: an installment, a fixed series, a registered subscription,
 * or the same name seen several times in `history` (the last ~6 months of same-name rows).
 */
export function rhythm(tx: Transaction, history: Transaction[], subscriptions: SubscriptionItem[]): Rhythm {
  if (tx.installment && tx.total_installments && tx.current_installment) {
    return { kind: "parcela", current: tx.current_installment, total: tx.total_installments, left: tx.total_installments - tx.current_installment };
  }
  if (tx.fixed) return { kind: "fixa", recurrence: tx.recurrence ?? "mensal" };
  const key = norm(tx.name);
  const sub = subscriptions.find((s) => norm(s.name) === key);
  if (sub) return { kind: "assinatura", name: sub.name };
  const same = history.filter((row) => row.type === tx.type && norm(row.name) === key);
  if (!same.some((row) => row.id === tx.id)) same.push(tx);
  if (same.length < 3) return { kind: "unica" };
  return { kind: "repete", times: same.length, average: same.reduce((sum, row) => sum + row.value, 0) / same.length };
}

/** Same-name totals per month, oldest first, for the small history strip. */
export function monthlyHistory(tx: Transaction, history: Transaction[], months: string[]): Array<{ month: string; total: number }> {
  const key = norm(tx.name);
  return months.map((month) => ({
    month,
    total: history.filter((row) => row.type === tx.type && norm(row.name) === key && row.date.slice(0, 7) === month)
      .reduce((sum, row) => sum + row.value, 0),
  }));
}

export interface MonthImpact {
  /** How the month closes with everything, this lançamento included. */
  closes: number;
  /** How it would close without it. */
  without: number;
  /** Share of the month's income (received plus expected); null without income. */
  ofIncome: number | null;
}

/** Weight of the lançamento on its month, read from that month's calendar. */
export function monthImpact(tx: Transaction, calendar: CalendarMonth | null | undefined): MonthImpact | null {
  if (!calendar || tx.type === "transferencia" || tx.date.slice(0, 7) !== calendar.month) return null;
  const income = calendar.income + calendar.projected_income;
  return {
    closes: calendar.projected_balance,
    without: calendar.projected_balance - signedAmount(tx),
    ofIncome: tx.type === "despesa" && income > 0 ? tx.value / income : null,
  };
}

/** Caixa (in Fluxo) opened on this lançamento's month and tab, with it in focus. */
export function cashFlowLink(tx: Transaction): string {
  const metric = tx.type === "receita" ? "receitas" : tx.type === "despesa" ? "despesas" : "caixa";
  // The whole month, with this lançamento in focus: its weight is read against everything else.
  const focus = tx.id.startsWith("offline:") ? "" : `&foco=${encodeURIComponent(tx.id)}`;
  return `/transacoes?aba=caixa&month=${tx.date.slice(0, 7)}&metric=${metric}${focus}`;
}

/**
 * The same weight read from the active budget cycle (the Orçamento screen). The cycle already
 * counts scheduled expenses as committed, so nothing is added for this one.
 */
export function cycleImpact(tx: Transaction, progress: BudgetCycleProgress | null | undefined): BudgetImpact | null {
  if (tx.type !== "despesa" || !tx.category_id || !progress) return null;
  if (tx.date < progress.start_date || tx.date > progress.end_date) return null;
  const row = progress.allocations.find((a) => a.category_id === tx.category_id);
  if (!row || row.planned <= 0) return null;
  const used = row.projected_close / row.planned;
  return {
    name: row.name ?? tx.category_name ?? "Categoria", budget: row.planned, spent: row.projected_close,
    remaining: row.available, used, share: tx.value / row.planned, counted: false,
    status: used > 1 ? "acima" : used >= 0.8 ? "proximo" : "dentro",
  };
}

export interface AllocationBreakdown {
  paid: Transaction[];
  committed: Transaction[];
  /** Installments of earlier purchases, fixed series and subscriptions the cycle counts without a row here. */
  other: number;
}

/** Splits a category's lançamentos in a cycle into realised and committed, and what the totals hold beyond them. */
export function allocationBreakdown(rows: Transaction[], allocation: Pick<BudgetAllocationProgress, "category_id" | "spent" | "committed">): AllocationBreakdown {
  const own = rows.filter((row) => row.type === "despesa" && row.category_id === allocation.category_id);
  const paid = own.filter((row) => row.status === "pago");
  const committed = own.filter((row) => row.status !== "pago");
  const listed = own.reduce((sum, row) => sum + row.value, 0);
  const other = Math.round((allocation.spent + allocation.committed - listed) * 100) / 100;
  return { paid, committed, other: other > 0.009 ? other : 0 };
}

export interface FocusFacts {
  /** Share of the month's expenses (or income) of the same kind, scheduled ones included. */
  share: number;
  ofIncome: number | null;
  /** 1 = the biggest of its kind in the month. */
  rank: number;
  count: number;
  impact: MonthImpact | null;
  rhythm: Rhythm;
  /** Fixed, subscription or repeating: what it costs in a year, and in the next six months. */
  yearly: number | null;
  nextSixMonths: number | null;
  /** Installments still to pay and the month the last one falls in. */
  remaining: { total: number; lastMonth: string } | null;
  /** Average per month of the same name in the previous months that had it, and this month against it. */
  average: number | null;
  vsAverage: number | null;
  budget: BudgetImpact | null;
  /** What is left in the category per day until the end of the month (current month only). */
  perDay: number | null;
  /** Freed per year by spending 10% less on it; only for what repeats. */
  tenPercentYear: number | null;
}

export interface FocusContext {
  today: string;
  monthRows: Transaction[];
  history: Transaction[];
  subscriptions: SubscriptionItem[];
  calendar: CalendarMonth | null | undefined;
  budget: BudgetSummary | null | undefined;
  cycle: BudgetCycleProgress | null | undefined;
}

/** Everything the Caixa says about one lançamento in its month: weight, impact, rhythm, budget, comparison. */
export function focusFacts(tx: Transaction, ctx: FocusContext): FocusFacts {
  const month = tx.date.slice(0, 7);
  const same = ctx.monthRows.filter((row) => row.type === tx.type && !row.invoice_payment && !row.invoice_refund && row.date.slice(0, 7) === month);
  if (!same.some((row) => row.id === tx.id)) same.push(tx);
  const ranked = [...same].sort((a, b) => b.value - a.value);
  const total = same.reduce((sum, row) => sum + row.value, 0);
  const impact = monthImpact(tx, ctx.calendar);
  const repeats = rhythm(tx, ctx.history, ctx.subscriptions);
  const months = Array.from({ length: 6 }, (_, i) => addMonthIso(month, i - 5));
  const perMonth = monthlyHistory(tx, ctx.history, months);
  const before = perMonth.filter((m) => m.month !== month && m.total > 0);
  const average = before.length ? before.reduce((s, m) => s + m.total, 0) / before.length : null;
  const thisMonth = perMonth.find((m) => m.month === month)?.total || tx.value;
  const sub = repeats.kind === "assinatura" ? ctx.subscriptions.find((s) => s.name.toLocaleLowerCase("pt-BR") === repeats.name.toLocaleLowerCase("pt-BR")) : undefined;
  const monthly = repeats.kind === "fixa" ? (repeats.recurrence === "anual" ? tx.value / 12 : tx.value)
    : repeats.kind === "assinatura" ? (sub?.recurrence === "anual" ? tx.value / 12 : tx.value)
    : repeats.kind === "repete" ? (average ?? thisMonth) : null;
  const budget = tx.type === "despesa" ? cycleImpact(tx, ctx.cycle) ?? budgetImpact(tx, ctx.budget) : null;
  const lastDay = Number(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate());
  const daysLeft = ctx.today.slice(0, 7) === month ? lastDay - Number(ctx.today.slice(8, 10)) + 1 : 0;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    share: total ? tx.value / total : 0,
    ofIncome: impact?.ofIncome ?? null,
    rank: ranked.findIndex((row) => row.id === tx.id) + 1,
    count: same.length,
    impact,
    rhythm: repeats,
    yearly: monthly !== null ? round(monthly * 12) : null,
    nextSixMonths: monthly !== null ? round(monthly * 6) : null,
    remaining: repeats.kind === "parcela" && repeats.left > 0 ? { total: round(repeats.left * tx.value), lastMonth: addMonthIso(month, repeats.left) } : null,
    average: average !== null ? round(average) : null,
    vsAverage: average ? Math.round(((thisMonth - average) / average) * 100) : null,
    budget,
    perDay: budget && budget.remaining > 0 && daysLeft > 0 ? round(budget.remaining / daysLeft) : null,
    tenPercentYear: monthly !== null && tx.type === "despesa" ? round(monthly * 12 * 0.1) : null,
  };
}

function addMonthIso(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
