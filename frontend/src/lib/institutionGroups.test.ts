import { describe, expect, it } from "vitest";
import { institutionKey, walletGroups } from "./institutionGroups";
import type { Account, CreditCard, Institution } from "@/types/finnos";

const account = (id: string, name: string, bank: string, balance: number, bankId?: string) =>
  ({ id, name, institution: bank, institution_id: bankId ?? null, balance } as Account);
const card = (id: string, bank: string, issuerId?: string, payerId?: string) =>
  ({ id, name: "Cartão " + id, institution: bank, institution_id: issuerId ?? null,
    payment_account_id: payerId ?? null, current_invoice: 25, available: 2000 } as CreditCard);
const bank = (id: string, name: string) =>
  ({ id, name, color: "#5B35FF", created_at: "2026-10-17T00:00:00Z" } as Institution);

describe("wallet institution grouping", () => {
  it("preserves cash balance without adding credit limits and merges legacy exact names visually", () => {
    const groups = walletGroups(
      [account("a1", "Principal", " Nubank ", 100.15), account("a2", "Poupança", "NUBANK", 20.25)],
      [card("c1", "nubank")], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("legacy:nubank");
    expect(groups[0].balanceCents).toBe(12040);
    expect(groups[0].cards).toHaveLength(1);
  });
  it("groups new registered bank by ID and never confuses issuer with payment account", () => {
    const institutions = [bank("nb", "Nubank"), bank("inter", "Banco Inter")];
    const groups = walletGroups(
      [account("a1", "Conta Inter", "Banco Inter", 400, "inter")],
      [card("c1", "Nubank", "nb", "a1")], institutions);
    const issuerGroup = groups.find(group => group.institutionId === "nb");
    const payerGroup = groups.find(group => group.institutionId === "inter");
    expect(issuerGroup?.cards.map(item => item.id)).toEqual(["c1"]);
    expect(payerGroup?.accounts.map(item => item.id)).toEqual(["a1"]);
    expect(issuerGroup?.balanceCents).toBe(0);
    expect(payerGroup?.balanceCents).toBe(40000);
  });
  it("does not merge aliases or invent bank IDs for names not present", () => {
    expect(institutionKey("  BANCO  Inter ")).toBe("banco inter");
    const groups = walletGroups([account("a1", "A", "Inter", 3)], [card("c1", "Banco Inter")], []);
    expect(groups).toHaveLength(2);
    expect(groups.every(group => group.institutionId === null)).toBe(true);
  });
  it("keeps unassigned records visible", () => {
    const group = walletGroups([account("a1","Dinheiro","",10)], [], [])[0];
    expect(group.key).toBe("unassigned");
    expect(group.accounts.map(account => account.id)).toEqual(["a1"]);
  });
});
