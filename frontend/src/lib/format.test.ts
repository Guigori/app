import { expect, it } from "vitest";
import { isISODate } from "./format";

it("accepts real YYYY-MM-DD calendar dates", () => {
  expect(isISODate("2026-11-04")).toBe(true);
  expect(isISODate("2028-02-29")).toBe(true);
});

it("rejects partial, malformed and impossible dates", () => {
  for (const value of ["", "2026-11", "2026-1-04", "04/11/2026", "2026-02-30", "2026-13-01", "2026-11-04T00:00"]) {
    expect(isISODate(value)).toBe(false);
  }
});
