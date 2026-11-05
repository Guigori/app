import { describe, expect, it } from "vitest";
import { fingerprint } from "./statementImport";

describe("fingerprint", () => {
  it("is stable for the same content", async () => {
    expect(await fingerprint("abc")).toBe(await fingerprint("abc"));
    expect(await fingerprint("abc")).not.toBe(await fingerprint("abd"));
  });
});
