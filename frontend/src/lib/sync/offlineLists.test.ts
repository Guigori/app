import { beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: "test-offline" } }, post: vi.fn(), put: vi.fn(), del: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ firebaseAuth: mocks.auth }));
vi.mock("@/lib/mode", () => ({ isLocalMode: () => false, getMode: () => "account" }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error { status: number; body: unknown; constructor(status: number) { super(String(status)); this.status = status; this.body = null; } },
  apiGet: mocks.get, apiPost: mocks.post, apiPut: mocks.put, apiDelete: mocks.del,
}));

import { flushSyncQueue, listSyncOperations, queueTransaction } from "./queue";
import { cacheSet } from "@/lib/offline/accountCache";
import { fetchTransactions, fetchTransactionsPage, isTransactionListComplete } from "@/lib/data";

const row = (id: string) => ({ id, version: 1, name: id, value: 10, type: "despesa", status: "pago", date: "2026-11-03", account_id: "bank" });
const input = { name: "Edit", value: 10, type: "despesa", status: "pago", date: "2026-11-03", account_id: "bank", fixed: false, installment: false } as never;

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
  for (const m of [mocks.post, mocks.put, mocks.del, mocks.get]) m.mockReset();
});

it("AUD-07: a list opened only through pagination is available offline, marked complete", async () => {
  mocks.get.mockResolvedValueOnce({ month: "2026-11", items: [row("a"), row("b")], next_cursor: null });
  await fetchTransactionsPage({ month: "2026-11" } as never);
  vi.stubGlobal("navigator", { onLine: false });
  const offline = await fetchTransactions({ month: "2026-11" } as never);
  expect(offline.map((t) => t.id)).toEqual(["a", "b"]);
  expect(await isTransactionListComplete({ month: "2026-11" } as never)).toBe(true);
});

it("AUD-07: with pages still unloaded the offline list is shown as partial, never as the whole month", async () => {
  mocks.get
    .mockResolvedValueOnce({ month: "2026-11", items: [row("a")], next_cursor: "a" })
    .mockResolvedValueOnce({ month: "2026-11", items: [row("b")], next_cursor: "b" });
  await fetchTransactionsPage({ month: "2026-11" } as never);
  await fetchTransactionsPage({ month: "2026-11" } as never, "a");
  vi.stubGlobal("navigator", { onLine: false });
  expect((await fetchTransactions({ month: "2026-11" } as never)).map((t) => t.id)).toEqual(["a", "b"]);
  expect(await isTransactionListComplete({ month: "2026-11" } as never)).toBe(false);
});

it("AUD-09: a second offline edit before sending is consolidated into the first", async () => {
  await cacheSet("firebase:test-offline:transaction:tx", { id: "tx", version: 1 });
  vi.stubGlobal("navigator", { onLine: false });
  await queueTransaction(input, "manual", "tx");
  await queueTransaction({ ...(input as object), value: 20 } as never, "manual", "tx");
  const queued = await listSyncOperations();
  expect(queued).toHaveLength(1);
  expect((queued[0].payload as { value: number }).value).toBe(20);
  vi.stubGlobal("navigator", { onLine: true });
  mocks.put.mockResolvedValueOnce({});
  await flushSyncQueue();
  expect(await listSyncOperations()).toEqual([]);
  expect(mocks.put).toHaveBeenCalledTimes(1);
});

it("AUD-09: an edit queued after the first was attempted depends on its result, not on the same base", async () => {
  await cacheSet("firebase:test-offline:transaction:tx", { id: "tx", version: 1 });
  vi.stubGlobal("navigator", { onLine: false });
  await queueTransaction(input, "manual", "tx");
  vi.stubGlobal("navigator", { onLine: true });
  mocks.put.mockRejectedValueOnce(new TypeError("Failed to fetch")); // first attempt: response lost
  await flushSyncQueue();
  vi.stubGlobal("navigator", { onLine: false });
  await queueTransaction({ ...(input as object), value: 30 } as never, "manual", "tx");
  expect((await listSyncOperations()).map((op) => op.baseVersion)).toEqual([1, 2]);
  vi.stubGlobal("navigator", { onLine: true });
  mocks.put.mockResolvedValue({});
  await flushSyncQueue();
  expect(await listSyncOperations()).toEqual([]);
  const versions = mocks.put.mock.calls.map((call) => (call[2] as Record<string, string>)["X-FINNOS-Base-Version"]);
  expect(versions).toEqual(["1", "1", "2"]);
});
