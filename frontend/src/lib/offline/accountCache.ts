const DB_NAME = "finnos-account-cache";
const DB_VERSION = 1;
const STORE = "snapshots";

interface Snapshot<T = unknown> {
  key: string;
  value: T;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheSet<T>(key: string, value: T): Promise<T> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key, value, savedAt: new Date().toISOString() } satisfies Snapshot<T>);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return value;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const result = await new Promise<Snapshot<T> | undefined>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Snapshot<T> | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result?.value ?? null;
}

export async function cachedFetch<T>(key: string, online: () => Promise<T>): Promise<T> {
  if (navigator.onLine) {
    try {
      return await cacheSet(key, await online());
    } catch (error) {
      const cached = await cacheGet<T>(key);
      if (cached !== null) return cached;
      throw error;
    }
  }
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  throw new Error("FINNOS_OFFLINE_NO_CACHE");
}

export async function clearAccountCache(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
