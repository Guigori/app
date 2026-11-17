import { describe, expect, it } from "vitest";
import { buildProjection, usualResult } from "@/lib/budget/projection";
import { buildClosing, buildMonthFlow } from "@/lib/budget/closing";
import type { Flow, Transaction } from "@/types/finnos";

const flow = (upcoming: unknown[]) => ({ upcoming } as unknown as Flow);
const tx = (p: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), name: "x", value: 10, type: "despesa", status: "pago", date: "2026-10-10", account_id: "nu", category_id: "merc", fixed: false, installment: false, ...p } as Transaction);

describe("Orçamento · projeção", () => {
  it("usual result is the average of months with movement", () => {
    expect(usualResult([{ month: "a", label: "", income: 5000, expense: 4600, net: 0 }, { month: "b", label: "", income: 5000, expense: 4640, net: 0 }, { month: "c", label: "", income: 0, expense: 0, net: 0 }])).toEqual({ base: 380, observed: 2 });
  });

  it("adds only what the person registered, never repeated or projected items", () => {
    const p = buildProjection({
      months: ["2026-12", "2027-01"],
      history: [{ month: "x", label: "", income: 5000, expense: 4620, net: 0 }],
      flows: {
        "2026-12": flow([{ date: "2026-12-20", name: "13º", value: 1550, type: "receita", kind: "agendado", transaction_id: "a" }, { date: "2026-12-10", name: "Internet", value: 120, type: "despesa", kind: "fixa" }, { date: "2026-12-28", name: "Academia", value: 99, type: "despesa", kind: "assinatura", subscription_id: "s" }]),
        "2027-01": flow([{ date: "2027-01-10", name: "IPVA", value: 1200, type: "despesa", kind: "agendado", transaction_id: "b" }, { date: "2027-01-15", name: "Férias", value: 800, type: "receita", kind: "pendente", transaction_id: "c" }]),
      },
    });
    expect(p.months[0].total).toBe(380 + 1550);
    expect(p.months[0].items).toHaveLength(1);
    expect(p.months[1].total).toBe(380 - 1200 + 800);
    expect(p.months[1].items.find((i) => i.name === "Férias")?.state).toBe("estimativa");
    expect(p.negative).toHaveLength(1);
    expect(p.yearly?.total).toBe(1200);
    expect(p.yearly?.perMonth).toBe(600);
  });
});

describe("Orçamento · fechar o mês", () => {
  it("separates what happened, what is still open and what was out of the plan", () => {
    const c = buildClosing({
      month: "2026-10", earned: 6050, spent: 5750, opening: 760, closing: 1060, previous: { merc: 860 },
      categories: [{ category_id: "merc", name: "Mercado", color: "", group: "necessidades", spent: 920, limit: 900, benefit: 0, special: 0, over: 20 }],
      transactions: [
        tx({ name: "Aluguel", value: 1650, fixed: true }),
        tx({ name: "Salário", value: 5800, type: "receita" }),
        tx({ name: "Freela", value: 400, type: "receita", status: "pendente", date: "2026-10-25" }),
        tx({ name: "Assaí", value: 310 }),
        tx({ name: "Feira", value: 90 }),
        tx({ name: "Transf", value: 500, type: "transferencia" }),
      ],
    });
    expect(c.result).toBe(300);
    expect(c.open.map((t) => t.name)).toEqual(["Freela"]);
    expect(c.happened.map((t) => t.name).sort()).toEqual(["Aluguel", "Salário"]);
    expect(c.unplanned.map((t) => t.name)).toEqual(["Assaí", "Feira"]);
    expect(c.insights.map((i) => i.id)).toEqual(["over", "open"]);
    expect(c.categories[0].previous).toBe(860);
  });
});

describe("Orçamento · como fechou", () => {
  it("goes from the opening balance to the closing one, and shows what does not fit as other movements", () => {
    const f = buildMonthFlow({
      month: "2026-10", benefitIds: new Set(["vr"]), opening: 760, closing: 1060,
      transactions: [
        tx({ name: "Salário", value: 5800, type: "receita" }),
        tx({ name: "Aluguel", value: 1650, fixed: true }),
        tx({ name: "Fatura", value: 860, invoice_payment: true }),
        tx({ name: "Assaí", value: 310 }),
        tx({ name: "Cartão", value: 99, card_id: "c" }),
        tx({ name: "VR", value: 40, account_id: "vr" }),
      ],
    });
    expect(f).toMatchObject({ income: 5800, bills: 1650, invoices: 860, daily: 310 });
    expect(f.other).toBe(1060 - (760 + 5800 - 1650 - 860 - 310));
  });
});
