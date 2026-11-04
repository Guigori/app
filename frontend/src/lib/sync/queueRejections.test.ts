import { beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: "test-queue" } }, post: vi.fn(), put: vi.fn(), del: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ firebaseAuth: mocks.auth }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number; body: unknown;
    constructor(status: number, body: unknown = null) { super(`request failed with ${status}`); this.status = status; this.body = body; }
  },
  apiGet: mocks.get, apiPost: mocks.post, apiPut: mocks.put, apiDelete: mocks.del,
}));

import { discardConflictedOperation, flushSyncQueue, listSyncOperations, queueTransaction } from "./queue";
import { ApiError } from "@/lib/api";

const Api = ApiError as unknown as new (status: number, body?: unknown) => Error;
const input = { name: "Mercado", value: 10, type: "despesa", status: "pago", date: "2026-11-03", account_id: "bank", fixed: false, installment: false } as never;

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { onLine: false });
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
  for (const m of [mocks.post, mocks.put, mocks.del, mocks.get]) m.mockReset();
});

for (const status of [400, 404, 422]) {
  it(`AUD-06: a definitive ${status} becomes reviewable, shows the server reason and can be discarded`, async () => {
    const first = await queueTransaction(input);
    await queueTransaction({ ...(input as object), name: "Depois" } as never);
    vi.stubGlobal("navigator", { onLine: true });
    mocks.post.mockRejectedValueOnce(new Api(status, { detail: "Conta inválida." })).mockResolvedValue({ id: "ok" });
    await flushSyncQueue();
    const [blocked, waiting] = await listSyncOperations();
    expect(blocked.status).toBe("conflict");
    expect(blocked.lastError).toBe("Conta inválida.");
    // FIFO still protects the dependent successor until the user decides.
    expect(waiting.attempts).toBe(0);
    await discardConflictedOperation(first.id);
    await flushSyncQueue();
    expect(await listSyncOperations()).toEqual([]);
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
}

it("network failures, 401 and 5xx stay retryable and are sent again with the same id", async () => {
  await queueTransaction(input);
  vi.stubGlobal("navigator", { onLine: true });
  for (const failure of [new TypeError("Failed to fetch"), new Api(401), new Api(503)]) {
    mocks.post.mockRejectedValueOnce(failure);
    await flushSyncQueue();
    expect((await listSyncOperations())[0].status).toBe("error");
  }
  mocks.post.mockResolvedValueOnce({ id: "ok" });
  await flushSyncQueue();
  expect(await listSyncOperations()).toEqual([]);
  const ids = mocks.post.mock.calls.map((call) => (call[2] as Record<string, string>)["X-FINNOS-Operation-ID"]);
  expect(new Set(ids).size).toBe(1);
});
