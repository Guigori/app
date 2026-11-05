import { describe, expect, it } from "vitest";
import type { DayFlow, FlowPoint, Transaction } from "@/types/finnos";
import { balanceTimeline, incomeSources, monthClose, upcoming, weeklyFlow } from "./cashFlow";

const p = (month: string, net: number, projected_net = 0): FlowPoint => ({ month, label: month.slice(5), year: "", income: Math.max(net, 0), expense: Math.max(-net, 0), net, projected_income: Math.max(projected_net, 0), projected_expense: Math.max(-projected_net, 0), projected_net, future: false });
const day = (date: string, income: number, expense: number): DayFlow => ({ date, income, expense, projected_income: 0, projected_expense: 0, count: 1, active_count: 1 });
const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t", name: "Salário", value: 5000, type: "receita", status: "pago", date: "2026-11-05", account_id: "a", account_name: "A",
  card_id: null, card_name: null, to_account_id: null, to_account_name: null, category_id: "renda", category_name: "Renda",
  category_color: "#0a0", category_icon: null, fixed: false, recurrence: null, installment: false, total_installments: null,
  current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null, created_at: "", ...over,
});

describe("monthClose", () => {
  it("adds what happened and what is still expected", () => {
    expect(monthClose({ net: -1220.27, projected_net: 2954.8 })).toBe(1734.53);
  });
});

describe("balanceTimeline", () => {
  it("walks back from today and forward with what is expected", () => {
    const out = balanceTimeline([p("2026-09", -600), p("2026-10", 3240.4), p("2026-11", -1220.27, 2954.8), p("2026-12", -800, -1706.6)], 8770.13, "2026-11");
    // Start of November = 8770.13 + 1220.27 = 9990.40 (= end of October); end of September = 9990.40 − 3240.40.
    expect(out.map((x) => x.real)).toEqual([6750, 9990.4, null, null]);
    expect(out.map((x) => x.forecast)).toEqual([null, 9990.4, 11724.93, 9218.33]);
  });
});

describe("weeklyFlow", () => {
  it("groups the month into weeks starting on the 1st", () => {
    const out = weeklyFlow("2026-11", [day("2026-11-01", 0, 100), day("2026-11-07", 50, 0), day("2026-11-08", 0, 30), day("2026-11-30", 0, 10)]);
    expect(out.map((w) => [w.label, w.income, w.expense])).toEqual([["1–7", 50, 100], ["8–14", 0, 30], ["15–21", 0, 0], ["22–28", 0, 0], ["29–30", 0, 10]]);
  });
});

describe("incomeSources and upcoming", () => {
  it("groups received income by category or name", () => {
    const out = incomeSources([tx({}), tx({ id: "2", value: 300, category_id: null, category_name: null, name: "Freela" }), tx({ id: "3", status: "agendado" })], "2026-11");
    expect(out.map((s) => [s.name, s.total])).toEqual([["Renda", 5000], ["Freela", 300]]);
  });
  it("lists what has not happened yet, by date", () => {
    const out = upcoming([tx({ id: "a", status: "agendado", date: "2026-11-25" }), tx({ id: "b", status: "pendente", type: "despesa", date: "2026-11-08" }), tx({ id: "c" }), tx({ id: "d", type: "transferencia", status: "agendado" })], "2026-11");
    expect(out.map((t) => t.id)).toEqual(["b", "a"]);
  });
});
