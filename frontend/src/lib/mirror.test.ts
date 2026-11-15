import { describe, expect, it } from "vitest";
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
  it("the copy is read-only while the engine reads it", () => {
    const copy = asLocalDb({ revision: 7, checksum_sha256: "", collections: { accounts: [{ id: "a" }] } });
    expect(withReadOnlyDb(copy, () => readDb().accounts.length)).toBe(1);
    expect(() => withReadOnlyDb(copy, () => writeDb(freshDb()))).toThrow("somente leitura");
    const other = asLocalDb({ revision: 8, checksum_sha256: "", collections: {} });
    expect(withReadOnlyDb(other, () => readDb())).toBe(other);
  });
});
