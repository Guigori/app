import { describe, expect, it } from "vitest";
import { proposalFor, recategorizeProposal, registerProposal, subscriptionsProposal, type ActionContext } from "./finnActions";
import type { Account, Category, SubscriptionItem, Transaction } from "@/types/finnos";

const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2), name: "Uber", value: 20, type: "despesa", status: "pago", date: "2026-11-02",
  account_id: "nu", account_name: "Nubank", card_id: null, card_name: null, to_account_id: null, to_account_name: null,
  category_id: "trans", category_name: "Transporte", category_color: null, category_icon: null, fixed: false, recurrence: null,
  installment: false, total_installments: null, current_installment: null, installment_value: null, adjusted_value: null,
  attachment: null, notes: null, created_at: "2026-11-02", ...over,
});
const ctx: ActionContext = {
  today: "2026-11-05",
  accounts: [{ id: "nu", name: "Nubank", active: true }, { id: "itau", name: "Itaú", active: true }] as Account[],
  categories: [{ id: "trans", name: "Transporte" }, { id: "rest", name: "Restaurantes" }, { id: "food", name: "Alimentação" }, { id: "other", name: "Outros" }] as Category[],
  transactions: [
    tx({}), tx({ date: "2026-10-01" }),
    tx({ name: "Padaria", value: 12, category_id: "other", category_name: "Outros" }), tx({ name: "Padaria", value: 8, category_id: "other", category_name: "Outros", date: "2026-10-10" }),
    tx({ name: "Spotify", value: 21.9, category_id: "other", date: "2026-09-05" }), tx({ name: "Spotify", value: 21.9, category_id: "other", date: "2026-10-05" }), tx({ name: "Spotify", value: 21.9, category_id: "other", date: "2026-11-05" }),
    tx({ name: "Netflix", value: 44.9, date: "2026-09-12" }), tx({ name: "Netflix", value: 44.9, date: "2026-10-12" }), tx({ name: "Netflix", value: 44.9, date: "2026-11-12" }),
  ],
  subscriptions: [{ name: "Netflix" } as SubscriptionItem],
  aliases: { lanche: "rest" },
};

describe("FINNOS IA proposes, the user confirms", () => {
  it("turns one sentence into several lançamentos, with categories it knows", () => {
    const p = registerProposal("café 3,80 e uber 14 hoje", ctx);
    expect(p?.kind).toBe("register");
    if (p?.kind !== "register") return;
    expect(p.entries.map((e) => [e.name, e.value, e.categoryId, e.date, e.accountId])).toEqual([
      ["Café", 3.8, "rest", "2026-11-05", "nu"],
      ["Uber", 14, "trans", "2026-11-05", "nu"],
    ]);
  });

  it("does not take a time of day for an amount", () => {
    const p = registerProposal("Uber hoje às 9h00 por 16,90", ctx, { intent: true });
    if (p?.kind !== "register") throw new Error("expected a proposal");
    expect(p.entries.map((e) => [e.name, e.value])).toEqual([["Uber", 16.9]]);
    expect(p.unknown).toEqual(["às 9h00"]);
  });

  it("uses what the user taught and the account named", () => {
    const p = registerProposal("anota lanche 25 no itaú ontem", ctx);
    if (p?.kind !== "register") throw new Error("expected a proposal");
    expect(p.entries[0]).toMatchObject({ name: "Lanche", value: 25, categoryId: "rest", accountId: "itau", date: "2026-11-04" });
  });

  it("never registers a question or a period", () => {
    expect(registerProposal("quanto gastei de uber este mês?", ctx)).toBeNull();
    expect(registerProposal("uber nos últimos 3 meses", ctx)).toBeNull();
    expect(registerProposal("posso comprar 300 em 3x?", ctx)).toBeNull();
    expect(registerProposal("meu dinheiro dura até o dia 15?", ctx)).toBeNull();
    expect(registerProposal("vou fechar o mês com 500", ctx)).toBeNull();
  });

  it("finds every lançamento to move to another category", () => {
    const p = recategorizeProposal("mova todas as compras da Padaria para Alimentação", ctx);
    expect(p).toMatchObject({ kind: "recategorize", toCategoryId: "food", toName: "Alimentação", total: 20, from: [{ name: "Outros", count: 2 }] });
    expect(recategorizeProposal("mova padaria para Viagens", ctx)).toEqual({ error: expect.stringContaining("viagens") });
  });

  it("suggests the payments that look like subscriptions and are not followed yet", () => {
    const p = subscriptionsProposal("encontre pagamentos que parecem assinaturas", ctx);
    if (p?.kind !== "subscriptions") throw new Error("expected candidates");
    expect(p.candidates.map((c) => [c.name, c.value, c.nextCharge, c.months])).toEqual([["Spotify", 21.9, "2026-11-05", 3]]);
  });

  it("picks the right kind of proposal", () => {
    expect(proposalFor("quais assinaturas eu pago?", ctx)).toBeNull();
    expect(proposalFor("café 3,80", ctx)).toMatchObject({ kind: "register" });
  });
});
