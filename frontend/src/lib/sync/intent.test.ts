import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: "test-intent" } }, post: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ firebaseAuth: mocks.auth }));
vi.mock("@/lib/mode", () => ({ isLocalMode: () => false, getMode: () => "account" }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error { status: number; constructor(status: number) { super(String(status)); this.status = status; } },
  apiGet: vi.fn(), apiPost: mocks.post, apiPut: mocks.put, apiDelete: vi.fn(),
}));

import { createTransaction, updateTransaction } from "@/lib/data";
import { ApiError } from "@/lib/api";

const input = { name: "Café", value: 9, type: "despesa", status: "pago", date: "2026-11-04", account_id: "bank", fixed: false, installment: false } as never;
const opIds = (mock: typeof mocks.post) => mock.mock.calls.map((call) => (call[2] as Record<string, string>)["X-FINNOS-Operation-ID"]);
const Api = ApiError as unknown as new (status: number) => Error;

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } });
  mocks.post.mockReset();
  mocks.put.mockReset();
});

it("AUD-05: a retry after a lost response reuses the operation id, so the server returns one document", async () => {
  mocks.post.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ id: "created" });
  await expect(createTransaction(input)).rejects.toThrow("Failed to fetch");
  await createTransaction(input);
  const [first, second] = opIds(mocks.post);
  expect(first).toBeTruthy();
  expect(second).toBe(first);
});

it("keeps the same id across a 5xx and forgets it once the server confirms", async () => {
  mocks.post.mockRejectedValueOnce(new Api(503)).mockResolvedValueOnce({ id: "a" }).mockResolvedValueOnce({ id: "b" });
  await expect(createTransaction(input)).rejects.toThrow();
  await createTransaction(input);
  await createTransaction(input); // a second identical purchase made on purpose
  const [a, b, c] = opIds(mocks.post);
  expect(b).toBe(a);
  expect(c).not.toBe(a);
});

it("a definitive rejection does not pin the id for a corrected retry", async () => {
  mocks.post.mockRejectedValueOnce(new Api(400)).mockResolvedValueOnce({ id: "ok" });
  await expect(createTransaction(input)).rejects.toThrow();
  await createTransaction(input);
  const [a, b] = opIds(mocks.post);
  expect(b).not.toBe(a);
});

it("different payloads never share an id", async () => {
  mocks.post.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(createTransaction(input)).rejects.toThrow();
  await expect(createTransaction({ ...(input as object), value: 10 } as never)).rejects.toThrow();
  const [a, b] = opIds(mocks.post);
  expect(b).not.toBe(a);
});

it("AUD-05: online edits send the version the user started from", async () => {
  mocks.put.mockResolvedValue({ id: "tx", version: 4 });
  await updateTransaction("tx", input, "manual", 3);
  const headers = mocks.put.mock.calls[0][2] as Record<string, string>;
  expect(headers["X-FINNOS-Base-Version"]).toBe("3");
  expect(headers["X-FINNOS-Operation-ID"]).toBeTruthy();
});
