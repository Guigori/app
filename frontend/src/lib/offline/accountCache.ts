import { firebaseAuth } from "@/lib/firebase";
import { isQuotaError, noteStaleShown, canSync } from "@/lib/quota";
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

/**
 * The server's answer when it can be reached; otherwise the last answer this device kept for the same account, or,
 * when there is none, the same screen computed from the device's copy of the account (`device`, lib/mirror.ts).
 */
export async function cachedFetch<T>(key: string, online: () => Promise<T>, device?: () => Promise<T | null>): Promise<T> {
  const uid = firebaseAuth?.currentUser?.uid;
  const scopedKey = uid ? `firebase:${uid}:${key}` : null;
  if (canSync()) {
    // Auth/server failures must remain visible; never substitute another snapshot. The one exception is the
    // database's daily limit: then the last snapshot of this same account is shown, marked as not current.
    let value: T;
    try {
      value = await online();
    } catch (error) {
      if (!scopedKey || !isQuotaError(error)) throw error;
      const cached = await cacheGet<T>(scopedKey).catch(() => null);
      if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
      const fallback = cached ?? (device ? await device().catch(() => null) : null);
      if (fallback === null) throw error;
      noteStaleShown();
      return fallback;
    }
    if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
    if (scopedKey) await cacheSet(scopedKey, value);
    if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
    return value;
  }
  if (!scopedKey) throw new Error("FINNOS_OFFLINE_NO_CACHE");
  const cached = await cacheGet<T>(scopedKey);
  if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  if (cached !== null) { if (navigator.onLine) noteStaleShown(); return cached; }
  const computed = device ? await device().catch(() => null) : null;
  if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  if (computed !== null) { if (navigator.onLine) noteStaleShown(); return computed; }
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
