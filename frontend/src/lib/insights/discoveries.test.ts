import { describe, expect, it } from "vitest";
import { discoveries } from "@/lib/insights/discoveries";
import type { Ctx } from "@/lib/insights/catalog";
import type { Transaction } from "@/types/finnos";

const tx = (o: Partial<Transaction>): Transaction => ({ id: Math.random().toString(), name: "X", value: 10, type: "despesa", status: "pago", date: "2026-11-05", account_id: "a", account_name: "Conta", card_id: null, card_name: null, to_account_id: null, to_account_name: null, category_id: "c", category_name: "Mercado", category_color: "#000", category_icon: null, fixed: false, recurrence: null, installment: false, total_installments: null, current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null, created_at: "", ...o });
const base: Ctx = { today: "2026-11-11", month: "2026-11", prevMonth: "2026-10", money: (v) => `R$ ${v.toFixed(2)}`, tx: [], prevTx: [], allTx: [], dashboard: null, prevDashboard: null, subs: null, cards: [], accounts: [], flow: null, prevHistory: null, history: null, budget: null, cycle: null, suggestion: null, categories: [] };

describe("discoveries", () => {
  it("puts what is late first and keeps the analysis it came from", () => {
    const list = discoveries({ ...base, tx: [tx({ name: "Luz", value: 200, status: "pendente", date: "2026-11-03" }), tx({ name: "Mercado", value: 300 })] });
    expect(list[0].id).toBe("em-aberto");
    expect(list[0].tone).toBe("bad");
  });
  it("tells what weighed most in the month, like Início", () => {
    const dashboard = { month: "2026-11", total_balance: 0, income: 0, expense: 2677.5, month_balance: 0, prev_income: null, prev_expense: null, invested: 0, rule: [], recent: [], categories: [{ category_id: "m", name: "Moradia", color: "#5b3", icon: "home", total: 1736.6, percent: 64.9 }] };
    const list = discoveries({ ...base, dashboard: dashboard as never });
    expect(list.find((d) => d.id === "categorias")?.text).toBe("Moradia representa 64,9% dos seus gastos neste período: R$ 1736.60.");
  });
});
