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
import { canSync } from "@/lib/quota";
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
  /** Changes applied since the last whole download (the whole copy is fetched again every FULL_EVERY). */
  deltas?: number;
}

interface MirrorChanges {
  full: boolean;
  revision: number;
  upserts?: Record<string, Record<string, unknown>[]>;
  deletes?: Record<string, string[]>;
}

const FULL_EVERY = 25;
/** A screen that matched the server this many times in a row is not compared any more. */
export const SHADOW_ENOUGH = 50;

/** The copy at `base` plus the documents that changed after it (GET /finance/mirror/changes). */
export function applyChanges(base: MirrorPayload, changes: MirrorChanges): MirrorPayload {
  const collections: Record<string, Record<string, unknown>[]> = {};
  const names = new Set([...Object.keys(base.collections), ...Object.keys(changes.upserts ?? {}), ...Object.keys(changes.deletes ?? {})]);
  for (const name of names) {
    const rows = new Map((base.collections[name] ?? []).map((row) => [String(row.id), row]));
    for (const row of changes.upserts?.[name] ?? []) rows.set(String(row.id), row);
    for (const id of changes.deletes?.[name] ?? []) rows.delete(String(id));
    collections[name] = [...rows.values()].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  }
  return { revision: changes.revision, checksum_sha256: "", collections };
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
const REPORT_KEY = "finnos:shadow-report:v2"; // v1 counted the same balances in another order as a difference
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
      let next: StoredMirror | null = null;
      const base = current;
      // Only what changed since the copy's revision (a few reads); the whole copy when the log cannot say,
      // when there is no copy yet, and every FULL_EVERY changes as a safety net.
      if (base && revision !== undefined && (base.deltas ?? 0) < FULL_EVERY) {
        const changes = await apiGet<MirrorChanges>(`/finance/mirror/changes?since=${base.revision}`);
        if (!changes.full && changes.revision >= base.revision) {
          next = { ...applyChanges(base, changes), uid, fetched_at: new Date().toISOString(), deltas: (base.deltas ?? 0) + 1 };
        }
      }
      if (!next) {
        const payload = await apiGet<MirrorPayload>("/finance/mirror");
        next = { ...payload, uid, fetched_at: new Date().toISOString(), deltas: 0 };
      }
      if (firebaseAuth?.currentUser?.uid !== uid) return null; // signed out or switched meanwhile
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

/** Erases every copy kept on this device. On sign-out the comparison report goes too; "Atualizar agora" keeps it
 *  (it is the proof that lets screens open from the device). */
export async function clearMirror(keepReport = false): Promise<void> {
  current = null;
  if (!keepReport) try { window.localStorage.removeItem(REPORT_KEY); } catch { /* ignore */ }
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

/** JSON with object keys sorted: the same balances listed in another order are the same balances. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function differ(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) > TOLERANCE;
  return stable(a) !== stable(b);
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Only what differs; for per-day or per-category maps, only the keys that differ (at most 5). */
function collect(pairs: Pair[]): Pair[] {
  return pairs.filter((p) => differ(p.server, p.device)).map((p) => {
    if (!isMap(p.server) || !isMap(p.device)) return p;
    const keys = [...new Set([...Object.keys(p.server), ...Object.keys(p.device)])].sort()
      .filter((k) => differ((p.server as Record<string, unknown>)[k], (p.device as Record<string, unknown>)[k])).slice(0, 5);
    return {
      field: p.field,
      server: Object.fromEntries(keys.map((k) => [k, (p.server as Record<string, unknown>)[k] ?? null])),
      device: Object.fromEntries(keys.map((k) => [k, (p.device as Record<string, unknown>)[k] ?? null])),
    };
  });
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

// Any screen without its own rule is compared whole: numbers to the cent, lists of records by id, and without the
// moments the answer was produced (…_at), empty values or `false` flags that one side omits.
function normalize(value: unknown, key = ""): unknown {
  if (key.endsWith("_at") || key === "generated" || key === "updated") return undefined;
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (Array.isArray(value)) {
    const items = value.map((v) => normalize(v));
    const byId = items.every((v) => isMap(v) && "id" in (v as object));
    const list = byId ? [...items].sort((a, b) => stable((a as { id: unknown }).id).localeCompare(stable((b as { id: unknown }).id))) : items;
    return list.length ? list : undefined;
  }
  if (isMap(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const n = normalize(v, k);
      if (n === undefined || n === null || n === "" || n === false) continue;
      out[k] = n;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

function walk(server: unknown, device: unknown, path: string, out: Pair[]) {
  if (out.length >= 6) return;
  if (isMap(server) && isMap(device)) {
    for (const k of [...new Set([...Object.keys(server), ...Object.keys(device)])].sort()) walk(server[k], device[k], path ? `${path}.${k}` : k, out);
    return;
  }
  if (Array.isArray(server) && Array.isArray(device) && server.length === device.length) {
    server.forEach((item, i) => walk(item, device[i], `${path}[${i}]`, out));
    return;
  }
  if (stable(server) !== stable(device)) out.push({ field: path || "(tudo)", server: server ?? null, device: device ?? null });
}

export function compareWhole(server: unknown, device: unknown): Pair[] {
  const out: Pair[] = [];
  walk(normalize(server), normalize(device), "", out);
  return out;
}

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
export function shadowCheck<T>(screen: string, path: string, server: T, device: () => T, force = false): void {
  if (!mirrorEnabled() || !canSync()) return;
  const run = async () => {
    try {
      const done = shadowReport().byScreen[screen];
      if (!force && done && done.checked >= SHADOW_ENOUGH && done.checked === done.matched) return; // proven for this screen
      const revision = servedRevision(path);
      if (revision === undefined) { record((r) => { r.skipped += 1; }); return; }
      const mirror = await syncMirror(revision);
      if (!mirror || mirror.revision !== revision) { record((r) => { r.skipped += 1; }); return; }
      const { withReadOnlyDb } = await import("@/lib/local/store");
      const computed = withReadOnlyDb(asLocalDb(mirror), device);
      const rule = (comparisons as Record<string, ((a: T, b: T) => Pair[]) | undefined>)[screen];
      const fields = rule ? rule(server, computed) : compareWhole(server, computed);
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

// --- "Este aparelho" (Configurações → Dados e backup) -------------------------------------------------------

export const REFRESH_COOLDOWN_MS = 60_000;
const REFRESHED_KEY = "finnos:mirror-refreshed-at";

export interface MirrorStatus {
  enabled: boolean;
  fetchedAt: string | null;
  revision: number | null;
  report: ShadowReport;
}

/** What this device holds for the signed-in person, without asking the server. */
export async function mirrorStatus(): Promise<MirrorStatus> {
  const uid = firebaseAuth?.currentUser?.uid;
  const report = shadowReport();
  if (!uid || !mirrorEnabled()) return { enabled: false, fetchedAt: null, revision: null, report };
  if (!current || current.uid !== uid) {
    const stored = await idb<StoredMirror>("readonly", (s) => s.get(uid)).catch(() => undefined);
    current = stored && stored.uid === uid ? stored : null;
  }
  return { enabled: true, fetchedAt: current?.fetched_at ?? null, revision: current?.revision ?? null, report };
}

/** Milliseconds until "Atualizar agora" may run again (0 = now). */
export function refreshWait(now = Date.now()): number {
  try {
    const last = Number(window.localStorage.getItem(REFRESHED_KEY) ?? 0);
    return Math.max(0, last + REFRESH_COOLDOWN_MS - now);
  } catch {
    return 0;
  }
}

/** Throws away this device's copy and comparison report, then fetches the copy again. */
export async function refreshMirror(): Promise<StoredMirror | null> {
  if (refreshWait() > 0) throw new Error("Aguarde um minuto para atualizar de novo.");
  try { window.localStorage.setItem(REFRESHED_KEY, String(Date.now())); } catch { /* ignore */ }
  await clearMirror(true);
  return syncMirror();
}

/** "atualizado há 3 min" for the copy's fetch time. */
export function deviceCopyAge(iso: string | null): string {
  if (!iso) return "ainda não atualizado";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "atualizado agora";
  if (minutes < 60) return `atualizado há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `atualizado há ${hours} h`;
  return `atualizado em ${new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
}


/**
 * A screen computed from this device's copy of the account, for when the server cannot answer (offline or the
 * database's daily limit). Null when there is no copy for the signed-in person.
 */
export async function computeFromDeviceCopy<T>(run: () => T): Promise<T | null> {
  const uid = firebaseAuth?.currentUser?.uid;
  if (!uid || isLocalMode() || typeof indexedDB === "undefined") return null;
  if (!current || current.uid !== uid) {
    const stored = await idb<StoredMirror>("readonly", (s) => s.get(uid)).catch(() => undefined);
    current = stored && stored.uid === uid ? stored : null;
  }
  if (!current) return null;
  const { withReadOnlyDb } = await import("@/lib/local/store");
  try {
    return withReadOnlyDb(asLocalDb(current), run);
  } catch {
    return null;
  }
}


// --- Screens opened from the device copy ----------------------------------------------------------------

/** A screen is opened from the device once it matched the server this many times without one difference. */
export const DEVICE_FIRST_AFTER = 20;
/** Even then, one opening in this many still asks the server and compares, so a new difference is caught. */
export const DEVICE_FIRST_SAMPLE = 10;

export function deviceFirstEnabled(): boolean {
  try {
    return mirrorEnabled() && window.localStorage.getItem("finnos:device-first") !== "off";
  } catch {
    return false;
  }
}

/** Screens the device copy already opens by itself (proven and not switched off). */
export function deviceFirstScreens(report = shadowReport()): string[] {
  if (!deviceFirstEnabled()) return [];
  return Object.entries(report.byScreen)
    .filter(([, s]) => s.checked >= DEVICE_FIRST_AFTER && s.matched === s.checked)
    .map(([name]) => name);
}

function sampleNow(screen: string): boolean {
  try {
    const key = `finnos:device-first-count:${screen}`;
    const count = Number(window.localStorage.getItem(key) ?? 0) + 1;
    window.localStorage.setItem(key, String(count));
    return count % DEVICE_FIRST_SAMPLE === 0;
  } catch {
    return true;
  }
}

/**
 * The screen computed on the device, without asking the server: only when it is proven for that screen, the app
 * knows the current revision (listening to changes) and the copy is at exactly that revision (fetched if needed,
 * only what changed). Null means "ask the server as usual" (and the caller then compares, `force`d).
 */
export async function deviceFirst<T>(screen: string, compute: () => T): Promise<{ value: T } | { sample: true } | null> {
  if (!canSync() || !deviceFirstScreens().includes(screen)) return null;
  const { knownRevision, revisionSeenAt } = await import("@/lib/liveUpdates");
  const { writeNotYetSeen } = await import("@/lib/writeMark");
  const revision = knownRevision();
  if (revision === null || writeNotYetSeen(revisionSeenAt())) return null;
  if (sampleNow(screen)) return { sample: true };
  const mirror = await syncMirror(revision).catch(() => null);
  if (!mirror || mirror.revision !== revision) return null;
  const { withReadOnlyDb } = await import("@/lib/local/store");
  try {
    return { value: withReadOnlyDb(asLocalDb(mirror), compute) };
  } catch {
    return null;
  }
}
