import { describe, expect, it } from "vitest";
import { isThisMonth, pinIndex } from "@/lib/chartPin";

describe("pinIndex", () => {
  it("starts on the row for now, else on the last row", () => {
    const rows = [{ month: "2026-09" }, { month: "2026-10" }, { month: "2026-11" }, { month: "2026-12" }];
    expect(pinIndex(rows, (r) => isThisMonth(r, "2026-11-05"))).toBe(2);
    expect(pinIndex(rows, (r) => isThisMonth(r, "2027-03-01"))).toBe(3);
    expect(pinIndex([], () => true)).toBeUndefined();
  });
});
