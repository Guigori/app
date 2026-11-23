import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), apiPost: (...args: unknown[]) => post(...(args as [])) }));
vi.mock("@/lib/mode", () => ({ isLocalMode: () => false }));

import { ApiError } from "@/lib/api";
import { isInviteError, reportClientError } from "@/lib/beta";

describe("beta", () => {
  beforeEach(() => {
    post.mockClear();
    vi.stubGlobal("window", { location: { pathname: "/fluxo", origin: "https://finnos.app" }, innerWidth: 390, innerHeight: 844, matchMedia: () => ({ matches: false }) });
  });

  it("recognizes the invite-only refusal", () => {
    expect(isInviteError(new ApiError(403, { detail: "convite" }))).toBe(true);
    expect(isInviteError(new ApiError(403, { detail: "Confirme seu e-mail" }))).toBe(false);
    expect(isInviteError(new Error("x"))).toBe(false);
  });

  it("reports each error once and skips network and API noise", () => {
    reportClientError(new TypeError("Cannot read properties of undefined (reading 'id')"));
    reportClientError(new TypeError("Cannot read properties of undefined (reading 'id')"));
    reportClientError(new TypeError("Failed to fetch"));
    reportClientError(new ApiError(500, null));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual(["/client-errors", expect.objectContaining({ kind: "error", screen: "/fluxo" })]);
  });
});
