import { describe, expect, it } from "vitest";
import { allocationBreakdown, budgetImpact, cashFlowLink, cycleImpact, flowPath, monthImpact, monthlyHistory, rhythm } from "./transactionInsight";
import type { BudgetCycleProgress, BudgetSummary, CalendarMonth, SubscriptionItem, Transaction } from "@/types/finnos";

const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t", name: "iFood", value: 86.4, type: "despesa", status: "pago", date: "2026-11-12",
  account_id: "a", account_name: "Nubank conta", card_id: null, card_name: null, to_account_id: null, to_account_name: null,
  category_id: "rest", category_name: "Restaurantes", category_color: "#f00", category_icon: null,
  fixed: false, recurrence: null, installment: false, total_installments: null, current_installment: null,
  installment_value: null, adjusted_value: null, attachment: null, notes: null, created_at: "2026-11-12", ...over,
});

describe("lançamento detail", () => {
  it("says where the money came from and where it went", () => {
    expect(flowPath(tx({ card_name: "Nubank crédito" }))).toEqual({ from: "Nubank crédito", to: "Restaurantes" });
    expect(flowPath(tx({ type: "receita", category_name: "Salário" }))).toEqual({ from: "Salário", to: "Nubank conta" });
    expect(flowPath(tx({ type: "transferencia", to_account_name: "Inter" }))).toEqual({ from: "Nubank conta", to: "Inter" });
  });

  it("weighs an expense against its category limit", () => {
    const budget = { rows: [{ category_id: "rest", name: "Restaurantes", budget: 500, spent: 410 }] } as BudgetSummary;
    expect(budgetImpact(tx({}), budget)).toMatchObject({ remaining: 90, status: "proximo" });
    expect(budgetImpact(tx({}), budget)?.share).toBeCloseTo(0.1728);
    expect(budgetImpact(tx({ status: "agendado" }), budget)).toMatchObject({ spent: 496.4, counted: true, status: "proximo" });
    expect(budgetImpact(tx({ category_id: "x" }), budget)).toBeNull();
    expect(budgetImpact(tx({ type: "receita" }), budget)).toBeNull();
  });

  it("tells installments, fixed series, subscriptions and repeated names apart", () => {
    expect(rhythm(tx({ installment: true, total_installments: 10, current_installment: 3 }), [], [])).toEqual({ kind: "parcela", current: 3, total: 10, left: 7 });
    expect(rhythm(tx({ fixed: true, recurrence: "mensal" }), [], [])).toEqual({ kind: "fixa", recurrence: "mensal" });
    expect(rhythm(tx({ name: "Netflix" }), [], [{ name: "NETFLIX" } as SubscriptionItem])).toEqual({ kind: "assinatura", name: "NETFLIX" });
    const seen = [tx({ id: "1", value: 60 }), tx({ id: "2", value: 100 }), tx({ id: "3", name: "Mercado" })];
    expect(rhythm(tx({}), seen, [])).toMatchObject({ kind: "repete", times: 3 });
    expect(rhythm(tx({}), [tx({ id: "1" })], [])).toEqual({ kind: "unica" });
  });

  it("totals the same name per month", () => {
    const rows = [tx({ id: "1", date: "2026-10-02", value: 50 }), tx({ id: "2", date: "2026-10-20", value: 30 }), tx({ id: "3" })];
    expect(monthlyHistory(tx({}), rows, ["2026-09", "2026-10", "2026-11"])).toEqual([
      { month: "2026-09", total: 0 }, { month: "2026-10", total: 80 }, { month: "2026-11", total: 86.4 },
    ]);
  });

  it("shows how the month closes with and without it", () => {
    const calendar = { month: "2026-11", income: 3000, projected_income: 1000, projected_balance: 1154 } as CalendarMonth;
    const impact = monthImpact(tx({}), calendar);
    expect(impact?.closes).toBe(1154);
    expect(impact?.without).toBeCloseTo(1240.4);
    expect(impact?.ofIncome).toBeCloseTo(0.0216);
    expect(monthImpact(tx({ date: "2026-10-01" }), calendar)).toBeNull();
    expect(monthImpact(tx({ type: "transferencia" }), calendar)).toBeNull();
  });

  it("opens the cash flow on its month, tab and category", () => {
    expect(cashFlowLink(tx({}))).toBe("/transacoes?aba=caixa&month=2026-11&metric=despesas&category_id=rest");
    expect(cashFlowLink(tx({ type: "transferencia" }))).toBe("/transacoes?aba=caixa&month=2026-11&metric=caixa");
  });
});

describe("budget cycle", () => {
  const progress = {
    start_date: "2026-11-01", end_date: "2026-11-30",
    allocations: [{ category_id: "rest", name: "Restaurantes", planned: 500, spent: 300, committed: 110, projected_close: 410, available: 90 }],
  } as BudgetCycleProgress;

  it("reads the limit from the cycle the lançamento falls in", () => {
    expect(cycleImpact(tx({}), progress)).toMatchObject({ budget: 500, spent: 410, remaining: 90, counted: false, status: "proximo" });
    expect(cycleImpact(tx({ date: "2026-12-01" }), progress)).toBeNull();
    expect(cycleImpact(tx({ category_id: "x" }), progress)).toBeNull();
  });

  it("splits what was paid from what is committed, and names what has no row", () => {
    const rows = [tx({ id: "1", value: 300 }), tx({ id: "2", value: 60, status: "agendado" }), tx({ id: "3", category_id: "x" })];
    const split = allocationBreakdown(rows, progress.allocations[0]);
    expect(split.paid.map((r) => r.id)).toEqual(["1"]);
    expect(split.committed.map((r) => r.id)).toEqual(["2"]);
    expect(split.other).toBe(50);
  });
});
