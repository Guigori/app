/** Pure helpers behind the lançamento detail: where the money went, its budget, its rhythm and its weight on the month. */
import type { BudgetSummary, CalendarMonth, SubscriptionItem, Transaction } from "@/types/finnos";

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

/** Fluxo de caixa opened on this lançamento's month, tab and category. */
export function cashFlowLink(tx: Transaction): string {
  const metric = tx.type === "receita" ? "receitas" : tx.type === "despesa" ? "despesas" : "caixa";
  const category = tx.category_id && tx.type !== "transferencia" ? `&category_id=${encodeURIComponent(tx.category_id)}` : "";
  return `/fluxo?month=${tx.date.slice(0, 7)}&metric=${metric}${category}`;
}
