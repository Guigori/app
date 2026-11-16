import { describe, expect, it, vi } from "vitest";
import { asLocalDb, comparisons } from "@/lib/mirror";
import { freshDb, withReadOnlyDb, writeDb, readDb } from "@/lib/local/store";
import type { Dashboard } from "@/types/finnos";

const dash = (over: Partial<Dashboard> = {}): Dashboard => ({
  month: "2026-11", total_balance: 100, income: 50, expense: 20, month_balance: 30, prev_income: null, prev_expense: null,
  invested: 0, categories: [{ category_id: "food", name: "Mercado", color: "#000", icon: "x", total: 20, percent: 100 }],
  rule: [], recent: [], ...over,
});

describe("device copy", () => {
  it("same numbers match; a cent of rounding is not a difference", () => {
    expect(comparisons.dashboard(dash(), dash({ total_balance: 100.004 }))).toEqual([]);
  });
  it("different totals and categories are reported by field", () => {
    const diff = comparisons.dashboard(dash(), dash({ expense: 25, categories: [] }));
    expect(diff.map((d) => d.field)).toEqual(["expense", "categories"]);
  });
  it("the same balances in another order are not a difference", () => {
    const a = [{ id: "x", balance: 10 }, { id: "y", balance: 20 }] as never;
    const b = [{ id: "y", balance: 20 }, { id: "x", balance: 10 }] as never;
    expect(comparisons.accounts(a, b)).toEqual([]);
    const c = [{ id: "y", balance: 21 }, { id: "x", balance: 10 }] as never;
    expect(comparisons.accounts(a, c)).toEqual([{ field: "balances", server: { y: 2000 }, device: { y: 2100 } }]);
  });
  it("applying the changes gives the new copy", async () => {
    const { applyChanges } = await import("@/lib/mirror");
    const base = { revision: 3, checksum_sha256: "x", collections: { transactions: [{ id: "a", v: 1 }, { id: "b", v: 2 }], accounts: [{ id: "k" }] } };
    const next = applyChanges(base, { full: false, revision: 5, upserts: { transactions: [{ id: "b", v: 20 }, { id: "c", v: 3 }] }, deletes: { transactions: ["a"], accounts: ["k"] } });
    expect(next.revision).toBe(5);
    expect(next.collections.transactions).toEqual([{ id: "b", v: 20 }, { id: "c", v: 3 }]);
    expect(next.collections.accounts).toEqual([]);
  });
  it("the copy is read-only while the engine reads it", () => {
    const copy = asLocalDb({ revision: 7, checksum_sha256: "", collections: { accounts: [{ id: "a" }] } });
    expect(withReadOnlyDb(copy, () => readDb().accounts.length)).toBe(1);
    expect(() => withReadOnlyDb(copy, () => writeDb(freshDb()))).toThrow("somente leitura");
    const other = asLocalDb({ revision: 8, checksum_sha256: "", collections: {} });
    expect(withReadOnlyDb(other, () => readDb())).toBe(other);
  });
});

describe("screens opened from the device", () => {
  it("only screens with enough matches and no difference", async () => {
    const { deviceFirstScreens, DEVICE_FIRST_AFTER } = await import("@/lib/mirror");
    const report = { checked: 0, matched: 0, skipped: 0, errors: 0, last: [], byScreen: {
      dashboard: { checked: DEVICE_FIRST_AFTER, matched: DEVICE_FIRST_AFTER },
      calendar: { checked: DEVICE_FIRST_AFTER + 5, matched: DEVICE_FIRST_AFTER + 4 },
      accounts: { checked: 3, matched: 3 },
    } };
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
    vi.stubGlobal("indexedDB", {});
    expect(deviceFirstScreens(report)).toEqual(["dashboard"]);
    store.set("finnos:device-first", "off");
    expect(deviceFirstScreens(report)).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("a save not yet seen by the listener", () => {
  it("keeps screens asking the server until the new revision arrives", async () => {
    const { markServerWrite, writeNotYetSeen } = await import("@/lib/writeMark");
    markServerWrite();
    expect(writeNotYetSeen(Date.now() - 60_000)).toBe(true);
    expect(writeNotYetSeen(Date.now() + 1)).toBe(false);
    expect(writeNotYetSeen(null)).toBe(false);
  });
});

describe("whole-screen comparison", () => {
  it("ignores order of records, cents rounding, timestamps and omitted empty values", async () => {
    const { compareWhole } = await import("@/lib/mirror");
    const server = { total: 10.004, items: [{ id: "b", v: 2 }, { id: "a", v: 1, note: null }], generated_at: "2026-11-16T10:00:00Z", flag: false };
    const device = { total: 10, items: [{ id: "a", v: 1 }, { id: "b", v: 2 }], generated_at: "2026-11-16T10:00:01Z", tags: [] };
    expect(compareWhole(server, device)).toEqual([]);
  });
  it("reports where a value differs", async () => {
    const { compareWhole } = await import("@/lib/mirror");
    expect(compareWhole({ items: [{ id: "a", v: 1 }] }, { items: [{ id: "a", v: 2 }] }))
      .toEqual([{ field: "items[0].v", server: 1, device: 2 }]);
  });
});
