import { beforeEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { freshDb, initializeLocalPersistence, readDb, writeDb } from "./store";
import { enableLocalMode } from "@/lib/mode";

// AUD-08: a newer copy must never lose to an older IndexedDB record on startup.
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
  enableLocalMode();
});

async function idbName(): Promise<string | undefined> {
  const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("finnos-local", 1); r.onsuccess = () => resolve(r.result); });
  const value = await new Promise<{ profile: { name: string } } | undefined>((resolve) => {
    const r = db.transaction("databases", "readonly").objectStore("databases").get("finnos:local-db");
    r.onsuccess = () => resolve(r.result);
  });
  db.close();
  return value?.profile.name;
}

it("recovers the newest write after an IndexedDB failure instead of the older record", async () => {
  writeDb(freshDb("Old"));
  await vi.waitFor(async () => expect(await idbName()).toBe("Old"));
  const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("blocked", "QuotaExceededError"); });
  writeDb({ ...readDb(), profile: { name: "New" } });
  await vi.waitFor(() => expect(JSON.parse(values.get("finnos:local-db")!).profile.name).toBe("New"));
  spy.mockRestore();
  await initializeLocalPersistence();
  expect(readDb().profile.name).toBe("New");
  // Recovery copies the winner into IndexedDB and only then drops the journal.
  expect(await idbName()).toBe("New");
  expect(values.has("finnos:local-db")).toBe(false);
});

it("keeps a synchronous journal until IndexedDB confirms, covering a closed tab", async () => {
  writeDb(freshDb("Saved"));
  // Before the async commit the journal already holds the write.
  expect(JSON.parse(values.get("finnos:local-db")!).profile.name).toBe("Saved");
  await vi.waitFor(() => expect(values.has("finnos:local-db")).toBe(false));
  expect(await idbName()).toBe("Saved");
});

it("revisions only grow, so an older journal never overrides a newer IndexedDB copy", async () => {
  writeDb(freshDb("A"));
  writeDb({ ...readDb(), profile: { name: "B" } });
  await vi.waitFor(async () => expect(await idbName()).toBe("B"));
  values.set("finnos:local-db", JSON.stringify({ ...freshDb("Stale"), revision: 1 }));
  await initializeLocalPersistence();
  expect(readDb().profile.name).toBe("B");
  expect(readDb().revision).toBeGreaterThanOrEqual(2);
});
