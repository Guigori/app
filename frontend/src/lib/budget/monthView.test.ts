import { describe, expect, it } from "vitest";
import { buildMonthView, stateOf, type MonthViewInput } from "@/lib/budget/monthView";
import type { Account, CreditCard, Flow, Transaction } from "@/types/finnos";

const acc = (id: string, balance: number, type: Account["type"] = "corrente"): Account => ({ id, name: id, institution: "", type, color: "#000", initial_balance: 0, active: true, balance, total_income: 0, total_expense: 0, created_at: "" });
const tx = (p: Partial<Transaction>): Transaction => ({ id: "t", name: "x", value: 10, type: "despesa", status: "pago", date: "2026-11-10", account_id: "nu", account_name: "", card_id: null, card_name: null, to_account_id: null, to_account_name: null, category_id: null, category_name: null, category_color: null, category_icon: null, fixed: false, recurrence: null, installment: false, total_installments: null, current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null, ...p } as Transaction);
const flow = (p: Partial<Flow> = {}): Flow => ({ month: "2026-11", from_month: "", to_month: "", income: 5800, expense: 1510, net: 0, projected_income: 0, projected_expense: 0, projected_net: 0, total_income: 0, total_expense: 0, total_net: 0, series: [], categories: [], upcoming: [], ...p });
const card = (p: Partial<CreditCard>): CreditCard => ({ id: "c1", name: "Nubank", institution: "", color: "", limit: 0, closing_day: 18, due_day: 20, payment_account_id: "nu", payment_account_name: null, active: true, invoice_paid: false, current_invoice: 0, future_installments: 0, used: 0, available: 0, used_percent: 0, cycle_start: "", next_closing: "2026-12-18", next_due: "2026-12-20", best_purchase_day: "", created_at: "", ...p } as CreditCard);

const base = (p: Partial<MonthViewInput> = {}): MonthViewInput => ({
  month: "2026-11", today: "2026-11-16", accounts: [acc("nu", 2000), acc("itau", 660), acc("vr", 420, "beneficio")], cards: [],
  flow: flow(), calendar: null, balance: null, budget: null, transactions: [], goals: [], ...p,
});

describe("Orçamento · início do mês", () => {
  it("maps the three states", () => {
    expect(stateOf({ kind: "pendente" })).toBe("estimativa");
    expect(stateOf({ kind: "fixa", transaction_id: null })).toBe("estimativa");
    expect(stateOf({ kind: "fixa", transaction_id: "a" })).toBe("agendado");
    expect(stateOf({ kind: "assinatura" })).toBe("agendado");
    expect(stateOf({ kind: "parcela", transaction_id: "a" })).toBe("agendado");
  });

  it("nothing the app repeats or projects enters the plan until the person approves it", () => {
    const input = base({ flow: flow({ upcoming: [
      { date: "2026-11-22", name: "Luz", value: 88, type: "despesa", kind: "fixa" },
      { date: "2026-11-28", name: "Academia", value: 99, type: "despesa", kind: "assinatura", subscription_id: "s1" },
      { date: "2026-11-20", name: "Cinema", value: 55, type: "despesa", kind: "agendado", transaction_id: "c1" },
    ] }) });
    const v = buildMonthView(input);
    expect(v.toPay).toBe(55);
    expect(v.suggestions.map((s) => s.name)).toEqual(["Luz", "Academia"]);
    const ok = buildMonthView({ ...input, approved: ["fx:Luz:2026-11-22"], ignored: ["sub:s1:2026-11-28"] });
    expect(ok.toPay).toBe(55 + 88);
    expect(ok.suggestions).toHaveLength(0);
    expect(ok.items.find((i) => i.name === "Luz")?.state).toBe("estimativa");
  });

  it("livre counts only what landed: accounts (no benefit) minus what is still to pay and the cushion", () => {
    const v = buildMonthView(base({
      cushion: 100,
      approved: ["sub:s1:2026-11-28"],
      flow: flow({ upcoming: [
        { date: "2026-11-22", name: "Luz", value: 88, type: "despesa", kind: "pendente" },
        { date: "2026-11-28", name: "Academia", value: 99, type: "despesa", kind: "assinatura", subscription_id: "s1" },
        { date: "2026-11-25", name: "Freela", value: 400, type: "receita", kind: "pendente" },
      ] }),
      cards: [card({ payable_invoice: 860, payable_due: "2026-11-20", payable_cycle: "2026-11" })],
    }));
    expect(v.inAccounts).toBe(2660);
    expect(v.toPay).toBe(88 + 99 + 860);
    expect(v.toReceive).toBe(400);
    expect(v.free).toBe(2660 - 1047 - 100);
    expect(v.daysLeft).toBe(15);
    expect(v.perDay).toBe(Math.floor(((2660 - 1147) / 15) * 100) / 100);
    expect(v.items.find((i) => i.name === "Fatura Nubank")?.state).toBe("agendado");
  });

  it("an estimate whose day passed still counts as to pay and raises an alert", () => {
    const v = buildMonthView(base({ flow: flow({ upcoming: [{ date: "2026-11-15", name: "Internet", value: 120, type: "despesa", kind: "pendente", transaction_id: "i1" }] }) }));
    expect(v.toPay).toBe(120);
    expect(v.alerts.some((a) => a.id === "late:tx:i1")).toBe(true);
  });

  it("projection: real days solid, then the estimate ends with what is expected", () => {
    const v = buildMonthView(base({
      balance: { month: "2026-11", opening_balance: 900, days: [{ date: "2026-11-15", balance: 2700 }, { date: "2026-11-16", balance: 2660 }], balance: 2660 },
      flow: flow({ upcoming: [{ date: "2026-11-20", name: "Fatura", value: 860, type: "despesa", kind: "agendado", transaction_id: "f" }, { date: "2026-11-25", name: "Freela", value: 400, type: "receita", kind: "pendente", transaction_id: "fr" }] }),
    }));
    expect(v.projection.filter((p) => p.kind === "real")).toHaveLength(2);
    expect(v.projection.at(-1)).toEqual({ date: "2026-11-30", value: 2660 - 860 + 400, kind: "previsto" });
    expect(v.lowest).toEqual({ date: "2026-11-20", value: 1800 });
  });

  it("limits: the cycle wins, benefit spending is counted and shown apart", () => {
    const v = buildMonthView(base({
      budget: { month: "2026-11", planned: 0, spent: 0, remaining: 0, percent: 0, income: 0, unbudgeted_spent: 0, rows: [
        { category_id: "rest", name: "Restaurantes", icon: "", color: "#f00", group: "desejos", budget: 250, spent: 310, remaining: 0, percent: 0, status: "acima" },
        { category_id: "merc", name: "Mercado", icon: "", color: "#0f0", group: "necessidades", budget: 900, spent: 640, remaining: 0, percent: 0, status: "dentro" },
        { category_id: "inv", name: "Investimentos", icon: "", color: "#00f", group: "metas", budget: 1000, spent: 0, remaining: 0, percent: 0, status: "dentro" },
      ] },
      cycleLimits: { rest: 400 },
      // the metas group is Metas' job, never a spending limit
      transactions: [tx({ id: "v1", account_id: "vr", category_id: "rest", value: 120 })],
    }));
    const rest = v.categories.find((c) => c.category_id === "rest")!;
    expect(rest.limit).toBe(400);
    expect(rest.benefit).toBe(120);
    expect(rest.over).toBe(0);
    expect(v.categories.some((c) => c.category_id === "inv")).toBe(false);
    expect(v.daily.limit).toBe(1300);
    expect(v.daily.spent).toBe(950);
  });

  it("suggests a match between a realized record and an open estimate, and respects a dismissal", () => {
    const input = base({
      flow: flow({ upcoming: [{ date: "2026-11-15", name: "Internet NET", value: 120, type: "despesa", kind: "pendente", transaction_id: "i1" }] }),
      transactions: [tx({ id: "n1", name: "NET SERVICOS", value: 132, date: "2026-11-13" })],
    });
    const v = buildMonthView(input);
    expect(v.match?.realized.id).toBe("n1");
    expect(v.match?.difference).toBe(12);
    expect(buildMonthView({ ...input, dismissedMatches: ["n1|tx:i1"] }).match).toBeNull();
  });

  it("planned metas are set aside, the projected livre adds what may come in, and alerts follow the settings", () => {
    const v = buildMonthView(base({ goalsReserve: 400, flow: flow({ upcoming: [{ date: "2026-11-25", name: "Freela", value: 400, type: "receita", kind: "pendente", transaction_id: "f" }] }) }));
    expect(v.free).toBe(2660 - 400);
    expect(v.projectedFree).toBe(2660 - 400 + 400);
    expect(v.outside).toEqual([{ id: "vr", name: "vr", value: 420, kind: "beneficio" }]);
    expect(v.alerts.some((a) => a.id === "income-est")).toBe(true);
    const quiet = buildMonthView(base({ alertsOn: { recebimento: false }, flow: flow({ upcoming: [{ date: "2026-11-25", name: "Freela", value: 400, type: "receita", kind: "pendente", transaction_id: "f" }] }) }));
    expect(quiet.alerts.some((a) => a.id === "income-est")).toBe(false);
  });

  it("a past month has no livre", () => {
    const v = buildMonthView(base({ month: "2026-10" }));
    expect(v.when).toBe("past");
    expect(v.free).toBe(0);
    expect(v.perDay).toBe(0);
  });
});
