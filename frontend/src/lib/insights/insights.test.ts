import { describe, expect, it } from "vitest";
import type { Invoice, Transaction } from "@/types/finnos";
import { closingForMonth, invoicePoint, mergeInvoicePoints, readInvoices } from "./invoices";
import { budgetPressure, installmentPlans, installmentSchedule, summarizeInstallments } from "./installments";
import { readFixedBills } from "./fixedBills";

const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t", name: "Item", value: 100, type: "despesa", status: "pago", date: "2026-11-10", account_id: "a", account_name: "Inter",
  card_id: null, card_name: null, to_account_id: null, to_account_name: null, category_id: null, category_name: null,
  category_color: null, category_icon: null, fixed: false, recurrence: null, installment: false, total_installments: null,
  current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null, created_at: "", ...over,
} as Transaction);
const inv = (cycle_end: string, total: number, over: Partial<Invoice> = {}): Invoice => ({
  card_id: "c", card_name: "C6", cycle_start: "", cycle_end, due_date: cycle_end.replace(/-\d\d$/, "-28"), total, paid: false, paid_amount: 0, paid_at: null, items: [], ...over,
});
const money = (v: number) => `R$ ${v.toFixed(2)}`;

describe("invoices", () => {
  it("uses the closing day, capped at the end of the month", () => {
    expect(closingForMonth({ closing_day: 31 }, "2026-02")).toBe("2026-02-28");
    expect(closingForMonth({ closing_day: 5 }, "2026-11")).toBe("2026-11-05");
  });
  it("compares the current invoice with the last one and reads what is booked ahead", () => {
    const points = [
      invoicePoint(-1, inv("2026-10-05", 300, { paid: true, paid_amount: 300 })),
      invoicePoint(0, inv("2026-11-05", 412.36, { items: [
        { id: "1", name: "Som Carro", date: "2026-10-25", value: 130.38, category_name: "Eletrônicos", category_color: "#f80", installment_label: "1/3" },
        { id: "2", name: "GPT", date: "2026-10-04", value: 281.98, category_name: "Assinaturas", category_color: "#00f", installment_label: null },
      ] })),
      invoicePoint(1, inv("2026-12-05", 278.17)),
      invoicePoint(2, inv("2027-01-05", 0)),
    ];
    const r = readInvoices(points, money, "2026-11-10");
    expect(r.change).toBe(112.36);
    expect(r.installmentsInPresent).toBe(130.38);
    expect(r.topCategory?.name).toBe("Assinaturas");
    expect(r.futureTotal).toBe(278.17);
    expect(r.findings.map((f) => f.tone)).toContain("bad");
    expect(r.findings.some((f) => f.text.includes("Dez já começa"))).toBe(true);
  });
  it("flags a past invoice that is overdue and unpaid", () => {
    const r = readInvoices([invoicePoint(-1, inv("2026-10-05", 200))], money, "2026-11-10");
    expect(r.findings[0]).toMatchObject({ tone: "bad" });
    expect(r.findings[0].text).toContain("venceu");
  });
  it("adds all cards by position", () => {
    const merged = mergeInvoicePoints([
      [invoicePoint(0, inv("2026-11-05", 100))],
      [invoicePoint(0, inv("2026-11-20", 50.5)), invoicePoint(1, inv("2026-12-20", 10))],
    ]);
    expect(merged.map((p) => [p.offset, p.total])).toEqual([[0, 150.5], [1, 10]]);
  });
});

describe("installments", () => {
  const som = tx({ id: "s", name: "Som Carro", value: 391.14, installment: true, total_installments: 3, current_installment: 1, date: "2026-11-25", card_id: "c6", card_name: "C6" });
  const tv = tx({ id: "v", name: "TV", value: 1200, installment: true, total_installments: 12, current_installment: 1, date: "2026-01-10", card_id: "nu", card_name: "Nubank" });
  it("knows which installment falls now and what is left", () => {
    const [plan] = installmentPlans([som], "2026-11");
    expect(plan).toMatchObject({ current: 1, left: 2, value: 130.38, remaining: 260.76, endMonth: "2027-01" });
    const tvPlan = installmentPlans([tv], "2026-11")[0];
    expect(tvPlan).toMatchObject({ current: 11, left: 1, endMonth: "2026-12" });
    expect(installmentPlans([tv], "2027-01")).toEqual([]);
  });
  it("filters by card and builds the schedule with the endings", () => {
    const plans = installmentPlans([som, tv], "2026-11", "c6");
    expect(plans).toHaveLength(1);
    const all = installmentPlans([som, tv], "2026-11");
    const schedule = installmentSchedule(all, "2026-11", 3);
    expect(schedule.map((m) => m.total)).toEqual([230.38, 230.38, 130.38]);
    expect(schedule[1].ending).toEqual(["TV"]);
    const pressure = budgetPressure(schedule, 1000, 100);
    expect(pressure[0]).toMatchObject({ committed: 330.38, share: 0.33038 });
    const s = summarizeInstallments(all, "2026-12");
    expect(s.freedNextMonth).toBe(100);
  });
});

describe("fixed bills", () => {
  it("separates paid, late and still to pay", () => {
    const txs = [
      tx({ id: "1", name: "Aluguel", value: 1000, fixed: true, date: "2026-11-03", status: "pago" }),
      tx({ id: "2", name: "Vivo", value: 41.99, fixed: true, date: "2026-11-07", status: "agendado" }),
      tx({ id: "3", name: "Google", value: 11.99, recurrence: "mensal", date: "2026-11-20", status: "agendado" }),
      tx({ id: "4", name: "Mercado", value: 300, date: "2026-11-05" }),
    ];
    const r = readFixedBills(txs, "2026-11-01", "2026-11-30", "2026-11-10");
    expect(r.bills.map((b) => [b.tx.name, b.state])).toEqual([["Vivo", "atrasado"], ["Google", "a pagar"], ["Aluguel", "pago"]]);
    expect(r).toMatchObject({ total: 1053.98, paidTotal: 1000, dueTotal: 53.98, paidCount: 1, lateCount: 1 });
    expect(r.next?.tx.name).toBe("Google");
    expect(r.days).toHaveLength(3);
  });
});
