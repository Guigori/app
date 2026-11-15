/**
 * Camada 6 — the account's data kept on this device, in shadow.
 *
 * The device keeps one copy of the person's data (IndexedDB, per signed-in user), fetched from
 * GET /api/finance/mirror only when the finance revision moves. The screens still show what the server answers;
 * after each answer the same screen is computed on the device with the local engine (lib/local/engine.ts) and the
 * two are compared. The report (`shadowReport()`) says how many screens matched and keeps the last differences, so
 * the device copy can be turned on screen by screen only after it proves to give the same numbers.
 *
 * Nothing here writes to the server, and nothing the person sees comes from the copy yet.
 * Off with localStorage "finnos:mirror" = "off". Erased when the person signs out.
 */
import { apiGet, servedRevision } from "@/lib/api";
import { firebaseAuth } from "@/lib/firebase";
import { isLocalMode } from "@/lib/mode";
import type { LocalDb } from "@/lib/local/store";
import type { Account, BalanceHistory, CalendarMonth, Dashboard } from "@/types/finnos";

interface MirrorPayload {
  revision: number;
  checksum_sha256: string;
  collections: Record<string, Record<string, unknown>[]>;
}

interface StoredMirror extends MirrorPayload {
  uid: string;
  fetched_at: string;
}

export interface ShadowDifference {
  screen: string;
  params: string;
  revision: number;
  fields: { field: string; server: unknown; device: unknown }[];
  at: string;
}

export interface ShadowReport {
  checked: number;
  matched: number;
  skipped: number;
  errors: number;
  byScreen: Record<string, { checked: number; matched: number }>;
  last: ShadowDifference[];
}

const IDB_NAME = "finnos-mirror";
const IDB_STORE = "copies";
const REPORT_KEY = "finnos:shadow-report";
const TOLERANCE = 0.005; // centavos: the server rounds to cents

let current: StoredMirror | null = null;
let syncing: Promise<StoredMirror | null> | null = null;

export function mirrorEnabled(): boolean {
  try {
    return !isLocalMode() && window.localStorage.getItem("finnos:mirror") !== "off" && typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = run(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** The copy for the signed-in person, fetched again only when `revision` is newer than the one kept. */
export async function syncMirror(revision?: number): Promise<StoredMirror | null> {
  const uid = firebaseAuth?.currentUser?.uid;
  if (!uid || !mirrorEnabled()) return null;
  if (!current || current.uid !== uid) {
    const stored = await idb<StoredMirror>("readonly", (s) => s.get(uid)).catch(() => undefined);
    current = stored && stored.uid === uid ? stored : null;
  }
  if (current && (revision === undefined || current.revision >= revision)) return current;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const payload = await apiGet<MirrorPayload>("/finance/mirror");
      if (firebaseAuth?.currentUser?.uid !== uid) return null; // signed out or switched meanwhile
      const next: StoredMirror = { ...payload, uid, fetched_at: new Date().toISOString() };
      current = next;
      await idb("readwrite", (s) => s.put(next, uid)).catch(() => undefined);
      return next;
    } catch {
      return current;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Erases every copy kept on this device (sign-out). */
export async function clearMirror(): Promise<void> {
  current = null;
  try { window.localStorage.removeItem(REPORT_KEY); } catch { /* ignore */ }
  await idb("readwrite", (s) => s.clear()).catch(() => undefined);
}

/** The copy in the shape the local engine reads. */
export function asLocalDb(mirror: MirrorPayload): LocalDb {
  const c = mirror.collections;
  const list = <T>(name: string) => (c[name] ?? []) as unknown as T[];
  return {
    profile: { name: "" },
    accounts: list("accounts"),
    institutions: list("institutions"),
    categories: list("categories"),
    transactions: list("transactions"),
    cards: list("cards"),
    subscriptions: list("subscriptions"),
    audit_events: [],
    revision: mirror.revision,
  };
}

// --- Comparing screens ------------------------------------------------------------------------------------

type Pair = { field: string; server: unknown; device: unknown };

function differ(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) > TOLERANCE;
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

function collect(pairs: Pair[]): Pair[] {
  return pairs.filter((p) => differ(p.server, p.device));
}

export const comparisons = {
  dashboard(server: Dashboard, device: Dashboard): Pair[] {
    const byCategory = (d: Dashboard) => Object.fromEntries(d.categories.map((c) => [c.category_id ?? "sem", Math.round(c.total * 100)]));
    return collect([
      { field: "total_balance", server: server.total_balance, device: device.total_balance },
      { field: "income", server: server.income, device: device.income },
      { field: "expense", server: server.expense, device: device.expense },
      { field: "month_balance", server: server.month_balance, device: device.month_balance },
      { field: "prev_income", server: server.prev_income, device: device.prev_income },
      { field: "prev_expense", server: server.prev_expense, device: device.prev_expense },
      { field: "categories", server: byCategory(server), device: byCategory(device) },
    ]);
  },
  calendar(server: CalendarMonth, device: CalendarMonth): Pair[] {
    const days = (m: CalendarMonth) => Object.fromEntries(m.days.map((d) => [d.date, [Math.round(d.income * 100), Math.round(d.expense * 100)]]));
    return collect([
      { field: "income", server: server.income, device: device.income },
      { field: "expense", server: server.expense, device: device.expense },
      { field: "projected_balance", server: server.projected_balance, device: device.projected_balance },
      { field: "days", server: days(server), device: days(device) },
    ]);
  },
  balanceHistory(server: BalanceHistory, device: BalanceHistory): Pair[] {
    const days = (h: BalanceHistory) => Object.fromEntries(h.days.map((d) => [d.date, Math.round(d.balance * 100)]));
    return collect([
      { field: "opening_balance", server: server.opening_balance, device: device.opening_balance },
      { field: "balance", server: server.balance, device: device.balance },
      { field: "days", server: days(server), device: days(device) },
    ]);
  },
  accounts(server: Account[], device: Account[]): Pair[] {
    const balances = (list: Account[]) => Object.fromEntries(list.map((a) => [a.id, Math.round((a.balance ?? 0) * 100)]));
    return collect([{ field: "balances", server: balances(server), device: balances(device) }]);
  },
};

export function shadowReport(): ShadowReport {
  try {
    const saved = JSON.parse(window.localStorage.getItem(REPORT_KEY) ?? "null") as ShadowReport | null;
    if (saved) return saved;
  } catch { /* fresh report */ }
  return { checked: 0, matched: 0, skipped: 0, errors: 0, byScreen: {}, last: [] };
}

function record(update: (r: ShadowReport) => void) {
  const report = shadowReport();
  update(report);
  try { window.localStorage.setItem(REPORT_KEY, JSON.stringify(report)); } catch { /* report is best effort */ }
}

/**
 * After the server answered `path`, computes the same screen on the device and records whether they match.
 * Runs when the browser is idle; never changes what is shown and never throws.
 */
export function shadowCheck<T>(screen: keyof typeof comparisons, path: string, server: T, device: () => T): void {
  if (!mirrorEnabled() || !navigator.onLine) return;
  const run = async () => {
    try {
      const revision = servedRevision(path);
      if (revision === undefined) { record((r) => { r.skipped += 1; }); return; }
      const mirror = await syncMirror(revision);
      if (!mirror || mirror.revision !== revision) { record((r) => { r.skipped += 1; }); return; }
      const { withReadOnlyDb } = await import("@/lib/local/store");
      const computed = withReadOnlyDb(asLocalDb(mirror), device);
      const fields = (comparisons[screen] as (a: T, b: T) => Pair[])(server, computed);
      record((r) => {
        r.checked += 1;
        const s = (r.byScreen[screen] ??= { checked: 0, matched: 0 });
        s.checked += 1;
        if (fields.length === 0) { r.matched += 1; s.matched += 1; return; }
        r.last = [{ screen, params: path, revision, fields: fields.slice(0, 6), at: new Date().toISOString() }, ...r.last].slice(0, 20);
      });
    } catch {
      record((r) => { r.errors += 1; });
    }
  };
  const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(() => void run());
  else setTimeout(() => void run(), 200);
}
