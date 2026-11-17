import { describe, expect, it } from "vitest";
import { buildSpendingView } from "@/lib/budget/spending";
import { buildNextMonthPlan, toggleDecision } from "@/lib/budget/nextMonth";
import type { Account, CreditCard, Flow, Transaction } from "@/types/finnos";

const tx = (p: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), name: "x", value: 10, type: "despesa", status: "pago", date: "2026-11-10", account_id: "nu", account_name: "", card_id: null, card_name: null, to_account_id: null, to_account_name: null, category_id: "merc", category_name: "Mercado", category_color: null, category_icon: null, fixed: false, recurrence: null, installment: false, total_installments: null, current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null, ...p } as Transaction);
const acc = (id: string, type: Account["type"] = "corrente") => ({ id, type } as Account);
const lim = (id: string, name: string, spent: number, limit: number) => ({ category_id: id, name, color: "#000", group: "necessidades", spent, limit, benefit: 0, special: 0, over: Math.max(0, spent - limit) });

describe("Orçamento · gastos do mês", () => {
  const view = buildSpendingView({
    month: "2026-11", today: "2026-11-13", accounts: [acc("nu"), acc("vr", "beneficio")],
    categories: [lim("merc", "Mercado", 340, 600), lim("rest", "Restaurantes", 120, 300)],
    transactions: [
      tx({ value: 128, date: "2026-11-12" }),
      tx({ value: 185, date: "2026-11-05", card_id: "c1" }),
      tx({ value: 40, date: "2026-11-09", account_id: "vr", category_id: "rest" }),
      tx({ value: 500, date: "2026-11-07", type: "transferencia" }),
      tx({ value: 860, date: "2026-11-08", invoice_payment: true }),
      tx({ value: 99, date: "2026-11-20", status: "agendado" }),
    ],
  });

  it("projects each category at the month's pace and says how much a day is left", () => {
    const merc = view.categories.find((c) => c.category_id === "merc")!;
    expect(merc.projected).toBeCloseTo((340 / 13) * 30, 1);
    expect(merc.passBy).toBeCloseTo((340 / 13) * 30 - 600, 1);
    expect(merc.perDay).toBe(Math.floor(((600 - 340) / 17) * 100) / 100);
    expect(view.driver?.name).toBe("Mercado");
    expect(view.pace).toBe("acelerado");
    expect(view.tip?.category).toBe("Mercado");
  });

  it("a fixed bill is not projected at the daily pace", () => {
    const v = buildSpendingView({ month: "2026-11", today: "2026-11-15", accounts: [acc("nu")], categories: [lim("casa", "Moradia", 1450, 1600)],
      transactions: [tx({ value: 1450, date: "2026-11-05", category_id: "casa", fixed: true })] });
    expect(v.categories[0].projected).toBe(1450);
    expect(v.categories[0].passBy).toBe(0);
  });

  it("counts by purchase (card included) or by what left the account; transfers and invoice payments never count", () => {
    expect(view.byPurchase).toBe(128 + 185 + 40);
    expect(view.onCards).toBe(185);
    // what left the accounts: debit and vales, plus the invoice paid in the month
    expect(view.leftAccounts).toBe(128 + 40 + 860);
    expect(view.origins.find((o) => o.id === "beneficio")?.value).toBe(40);
    expect(view.recent).toHaveLength(3);
    expect(view.weeks[1]).toMatchObject({ label: "8–14", value: 168, current: true });
  });
});

describe("Orçamento · planejar o próximo mês", () => {
  const flow = { upcoming: [
    { date: "2026-12-05", name: "Salário", value: 5800, type: "receita", kind: "agendado", transaction_id: "s" },
    { date: "2026-12-10", name: "Internet", value: 120, type: "despesa", kind: "fixa" },
    { date: "2026-12-28", name: "Academia", value: 99, type: "despesa", kind: "assinatura", subscription_id: "a" },
    { date: "2026-12-15", name: "Aluguel", value: 1650, type: "despesa", kind: "agendado", transaction_id: "al" },
  ] } as unknown as Flow;
  const cards = [{ id: "c1", name: "Nubank", active: true, next_due: "2026-12-20", current_invoice: 385, payable_due: "2026-11-20", payable_invoice: 860 } as CreditCard];

  it("starts with what the person registered and the invoices; repeated and projected items wait to be included", () => {
    const p = buildNextMonthPlan({ month: "2026-12", flow, cards, habit: 1450, save: { viagem: 400 } });
    expect(p.inTotal).toBe(5800);
    expect(p.billTotal).toBe(1650 + 385);
    expect(p.bills.filter((b) => !b.on).map((b) => b.name)).toEqual(["Internet", "Academia"]);
    expect(p.spend).toBe(5800 - 2035 - 400);
    expect(p.tone).toBe("pode");
  });

  it("including a suggestion approves it; leaving a registered bill out keeps it in Fluxo but off this month", () => {
    const base = buildNextMonthPlan({ month: "2026-12", flow, cards, habit: 0 });
    const internet = base.bills.find((b) => b.name === "Internet")!;
    const aluguel = base.bills.find((b) => b.name === "Aluguel")!;
    expect(toggleDecision(internet)).toBe("approve");
    expect(toggleDecision(aluguel)).toBe("ignore");
    const p = buildNextMonthPlan({ month: "2026-12", flow, cards, habit: 0, approved: [internet.key], ignored: [aluguel.key] });
    expect(p.billTotal).toBe(120 + 385);
    expect(buildNextMonthPlan({ month: "2026-12", flow, cards, habit: 9999 }).tone).toBe("atencao");
    expect(buildNextMonthPlan({ month: "2026-12", flow, cards, habit: 0, save: { x: 9000 } }).tone).toBe("nao-fecha");
  });
});
