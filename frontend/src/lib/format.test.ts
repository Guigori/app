import { expect, it } from "vitest";
import { isISODate, toLocalISO } from "./format";

it("accepts real YYYY-MM-DD calendar dates", () => {
  expect(isISODate("2026-11-04")).toBe(true);
  expect(isISODate("2028-02-29")).toBe(true);
});

it("rejects partial, malformed and impossible dates", () => {
  for (const value of ["", "2026-11", "2026-1-04", "04/11/2026", "2026-02-30", "2026-13-01", "2026-11-04T00:00"]) {
    expect(isISODate(value)).toBe(false);
  }
});

it("AUD-15: civil dates stay on the device's day near midnight, unlike toISOString()", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/Sao_Paulo";
    const lateEvening = new Date("2026-11-05T02:30:00Z"); // 23:30 on 04/11 in São Paulo
    expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(toLocalISO(lateEvening)).toBe("2026-11-04");
    process.env.TZ = "Pacific/Auckland";
    const localNoon = new Date(2026, 10, 4, 12); // noon on 04/11 in Auckland = 23:00Z on 03/11
    expect(localNoon.toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(toLocalISO(localNoon)).toBe("2026-11-04");
  } finally {
    process.env.TZ = previous;
  }
});
