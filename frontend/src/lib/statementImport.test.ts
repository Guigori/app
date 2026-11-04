import { describe, expect, it } from "vitest";
import { fingerprint, isLikelyDuplicate } from "./statementImport";

describe("isLikelyDuplicate", () => {
  const row = { date: "2026-11-03", description: "Padaria Bom Pão", value: 12.5, type: "despesa" as const };
  it("matches same day, value, direction and description", () => {
    expect(isLikelyDuplicate(row, [{ date: "2026-11-03", value: 12.5, name: "Padaria", type: "despesa" }])).toBe(true);
  });
  it("does not match another day or direction", () => {
    expect(isLikelyDuplicate(row, [{ date: "2026-11-04", value: 12.5, name: "Padaria", type: "despesa" }])).toBe(false);
    expect(isLikelyDuplicate(row, [{ date: "2026-11-03", value: 12.5, name: "Padaria", type: "receita" }])).toBe(false);
  });
});

describe("fingerprint", () => {
  it("is stable for the same content", async () => {
    expect(await fingerprint("abc")).toBe(await fingerprint("abc"));
    expect(await fingerprint("abc")).not.toBe(await fingerprint("abd"));
  });
});
