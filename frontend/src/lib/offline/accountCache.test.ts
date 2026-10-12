import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ currentUser: { uid: "user-a" } as { uid: string } | null }));
vi.mock("@/lib/firebase", () => ({ firebaseAuth: auth }));
import { cachedFetch } from "./accountCache";

const snapshots = new Map<string, unknown>();
beforeEach(() => {
  snapshots.clear();
  auth.currentUser = { uid: "user-a" };
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("indexedDB", {
    open() {
      const request = { result: {
        close() {},
        transaction() {
          const transaction = { oncomplete: null as (() => void) | null, objectStore() {
            return {
              put(value: { key: string }) {
                snapshots.set(value.key, value);
                queueMicrotask(() => transaction.oncomplete?.());
              },
              get(key: string) {
                const get = { result: snapshots.get(key), onsuccess: null as (() => void) | null };
                queueMicrotask(() => get.onsuccess?.());
                return get;
              },
            };
          }};
          return transaction;
        },
      }, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
});

it("stores real snapshots per verified client identity and never shares offline data", async () => {
  await cachedFetch("accounts", async () => [{ name: "Conta A" }]);
  vi.stubGlobal("navigator", { onLine: false });
  expect(await cachedFetch("accounts", vi.fn())).toEqual([{ name: "Conta A" }]);
  auth.currentUser = { uid: "user-b" };
  await expect(cachedFetch("accounts", vi.fn())).rejects.toThrow("FINNOS_OFFLINE_NO_CACHE");
});

it("does not hide an online auth or backend failure with a cached balance", async () => {
  await cachedFetch("dashboard", async () => ({ total_balance: 500 }));
  await expect(cachedFetch("dashboard", async () => { throw new Error("401"); })).rejects.toThrow("401");
  await expect(cachedFetch("dashboard", async () => { throw new Error("503"); })).rejects.toThrow("503");
});

it("rejects a result that arrives after the identity changes", async () => {
  await expect(cachedFetch("accounts", async () => {
    auth.currentUser = { uid: "user-b" };
    return [{ name: "Conta A" }];
  })).rejects.toThrow("FINNOS_SESSION_CHANGED");
  expect(snapshots.size).toBe(0);
});

it("does not recover legacy unscoped snapshots or offline data without identity", async () => {
  snapshots.set("accounts", { key: "accounts", value: [{ name: "Legacy" }] });
  vi.stubGlobal("navigator", { onLine: false });
  await expect(cachedFetch("accounts", vi.fn())).rejects.toThrow("FINNOS_OFFLINE_NO_CACHE");
  auth.currentUser = null;
  await expect(cachedFetch("accounts", vi.fn())).rejects.toThrow("FINNOS_OFFLINE_NO_CACHE");
});
