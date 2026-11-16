import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

const quota = await import("@/lib/quota");
const { ApiError } = await import("@/lib/api");

describe("database daily limit", () => {
  beforeEach(() => store.clear());

  it("blocks until the time the server gave, and not after", () => {
    const now = Date.parse("2026-11-16T02:59:00Z");
    quota.markQuotaExhausted("2026-11-16T08:00:00Z", now);
    expect(quota.quotaBlockedUntil(now)).toBe(Date.parse("2026-11-16T08:00:00Z"));
    expect(quota.quotaBlockedUntil(Date.parse("2026-11-16T08:00:01Z"))).toBe(0);
  });

  it("without a usable time it backs off 15 minutes", () => {
    const now = 1_000_000;
    quota.markQuotaExhausted(undefined, now);
    expect(quota.quotaBlockedUntil(now)).toBe(now + 15 * 60_000);
  });

  it("recognises the server's answer and nothing else", () => {
    expect(quota.isQuotaError(new ApiError(503, { code: "quota_exhausted" }))).toBe(true);
    expect(quota.isQuotaError(new ApiError(503, { detail: "x" }))).toBe(false);
    expect(quota.isQuotaError(new ApiError(500, { code: "quota_exhausted" }))).toBe(false);
  });

  it("while blocked the app does not ask the server, except the session check", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    quota.markQuotaExhausted(new Date(Date.now() + 3600_000).toISOString());
    const { apiGet } = await import("@/lib/api");
    await expect(apiGet("/dashboard")).rejects.toMatchObject({ status: 503 });
    expect(fetchSpy).not.toHaveBeenCalled();
    await apiGet("/auth/me").catch(() => undefined);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    quota.clearQuotaBlock();
    expect(quota.quotaBlockedUntil()).toBe(0);
  });
});

describe("paused synchronisation message", () => {
  it("says records stay on this device and go to the cloud later", async () => {
    const { describeSyncQueue } = await import("@/lib/sync/presentation");
    expect(describeSyncQueue([], "paused", false).text).toBe("Sincronização pausada · você está usando os dados deste aparelho");
    expect(describeSyncQueue([], "paused", false, Date.parse("2026-11-16T08:00:00Z")).text).toMatch(/^Sincronização pausada até \d\d:\d\d · /);
    const op = { id: "1", kind: "transaction.create", status: "pending" } as never;
    expect(describeSyncQueue([op], "paused", false).text).toContain("1 lançamento salvo neste aparelho, vai para a nuvem quando voltar");
  });
});
