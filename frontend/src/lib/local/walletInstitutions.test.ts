import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enableLocalMode } from "@/lib/mode";
import { freshDb, readDb, writeDb } from "@/lib/local/store";
import {
  localCreateAccount, localCreateCard, localCreateInstitution, localLinkLegacyInstitutions,
  localListAccounts, localListCards, localSetDefaultAccount, localSetDefaultCard, localUpdateAccount,
} from "@/lib/local/engine";
import { INSTITUTION_CATALOG, fallbackColor, institutionIdentity } from "@/lib/institutionCatalog";
import { defaultAccount, defaultCard, effectiveDefaults, accountScope } from "@/lib/walletDefaults";
import type { AccountInput, CardInput } from "@/types/finnos";

const account = (over: Partial<AccountInput> = {}): AccountInput => ({ name: "Conta", institution: "", type: "corrente", color: "#070F52", initial_balance: 0, active: true, ...over });
const card = (over: Partial<CardInput> = {}): CardInput => ({ name: "Cartão", institution: "", color: "#5B3FE4", limit: 1000, closing_day: 3, due_day: 10, payment_account_id: null, active: true, ...over });

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  enableLocalMode();
  writeDb(freshDb());
});
afterEach(() => { vi.unstubAllGlobals(); });

test("a catalog entry or the exact catalog name brings the bank color; aliases do not", () => {
  expect(institutionIdentity("", "nubank")).toEqual({ name: "Nubank", color: "#820AD1", kind: "banco", catalog_id: "nubank" });
  expect(institutionIdentity(" ITAÚ ").color).toBe("#EC7000");
  expect(institutionIdentity("Banco Inter").catalog_id).toBeNull();
  expect(institutionIdentity("Banco Inter").color).toBe(fallbackColor("Banco Inter"));
  expect(INSTITUTION_CATALOG.filter((i) => i.kind === "beneficio").map((i) => i.name)).toContain("Alelo");
});

test("saving an account with a typed bank links the institution and takes its color", () => {
  const saved = localCreateAccount(account({ institution: "Nubank", color: "#123456" }));
  expect(saved.institution_id).toBeTruthy();
  expect(saved.color).toBe("#820AD1");
  // A second account in the same bank reuses the institution; cash has none.
  const second = localCreateAccount(account({ name: "Reserva", institution: "nubank" }));
  expect(second.institution_id).toBe(saved.institution_id);
  const cash = localCreateAccount(account({ name: "Carteira", institution: "Dinheiro", type: "carteira" }));
  expect(cash.institution_id ?? null).toBeNull();
  expect(readDb().institutions).toHaveLength(1);
});

test("an institution created twice by name is the same one", () => {
  const first = localCreateInstitution({ name: "Cooperativa Local" });
  expect(localCreateInstitution({ name: "  cooperativa local " }).id).toBe(first.id);
  expect(() => localCreateInstitution({ name: "a" })).toThrow();
});

test("there is a single default account per kind and editing without the flag keeps it", () => {
  const a = localCreateAccount(account({ name: "A", institution: "Itaú" }));
  const b = localCreateAccount(account({ name: "B", institution: "Nubank" }));
  const vr = localCreateAccount(account({ name: "VR", institution: "Alelo", type: "beneficio" }));
  // Nobody chose: the oldest of each kind.
  expect(localListAccounts().filter((x) => x.is_default).map((x) => x.name)).toEqual(["A", "VR"]);
  localSetDefaultAccount(b.id);
  expect(localListAccounts().filter((x) => x.is_default).map((x) => x.name)).toEqual(["B", "VR"]);
  localUpdateAccount(b.id, account({ name: "B2", institution: "Nubank", institution_id: b.institution_id }));
  expect(localListAccounts().find((x) => x.id === b.id)?.is_default).toBe(true);
  localUpdateAccount(a.id, account({ name: "A", institution: "Itaú", institution_id: a.institution_id, is_default: true }));
  expect(localListAccounts().filter((x) => x.is_default).map((x) => x.name)).toEqual(["A", "VR"]);
  expect(vr.institution).toBe("Alelo");
});

test("cards have one default and their color comes from the bank", () => {
  const roxinho = localCreateCard(card({ name: "Roxinho", institution: "Nubank" }));
  const casa = localCreateCard(card({ name: "Casa", institution: "Itaú", is_default: true }));
  expect(roxinho.color).toBe("#820AD1");
  expect(localListCards().filter((c) => c.is_default).map((c) => c.name)).toEqual(["Casa"]);
  localSetDefaultCard(roxinho.id);
  expect(localListCards().filter((c) => c.is_default).map((c) => c.name)).toEqual(["Roxinho"]);
  expect(casa.institution).toBe("Itaú");
});

test("older text-only banks are linked once", () => {
  const db = readDb();
  db.accounts.push({ id: "old", name: "Conta antiga", institution: "Banco do Brasil", type: "corrente", color: "#000000", initial_balance: 0, active: true, balance: 0, total_income: 0, total_expense: 0, created_at: "2026-01-01T00:00:00Z" });
  db.cards.push({ id: "c-old", name: "Cartão antigo", institution: "banco do brasil", color: "#000000", limit: 500, closing_day: 1, due_day: 8, payment_account_id: null, active: true, created_at: "2026-01-01T00:00:00Z" } as never);
  writeDb(db);
  expect(localLinkLegacyInstitutions()).toEqual({ linked_accounts: 1, linked_cards: 1, created_institutions: 1 });
  expect(localListAccounts()[0].color).toBe("#0038A8");
  expect(localLinkLegacyInstitutions()).toEqual({ linked_accounts: 0, linked_cards: 0, created_institutions: 0 });
});

test("registers preselect the default of the right kind", () => {
  const items = [
    { id: "1", type: "corrente" as const, created_at: "2026-01-01" },
    { id: "2", type: "digital" as const, created_at: "2026-02-01", is_default: true },
    { id: "3", type: "beneficio" as const, created_at: "2026-03-01" },
  ];
  expect([...effectiveDefaults(items, (x) => accountScope(x.type))].sort()).toEqual(["2", "3"]);
  const accounts = items.map((x) => ({ ...x, name: x.id, institution: "", color: "", initial_balance: 0, active: true, balance: 0, total_income: 0, total_expense: 0 }));
  expect(defaultAccount(accounts)?.id).toBe("2");
  expect(defaultAccount(accounts, "benefit")?.id).toBe("3");
  expect(defaultCard([{ id: "x", active: false, is_default: true }, { id: "y", active: true }] as never)?.id).toBe("y");
});
