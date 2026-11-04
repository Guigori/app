// AUD-05: stable identity for an online financial write whose response may be lost.
//
// The id is stored *before* the first request, keyed by UID + write kind + exact
// payload. A retry of the same intent after a network failure or 5xx reuses it,
// so the server's idempotent receipt returns the original document instead of
// creating a duplicate. A confirmed answer (success or definitive rejection)
// forgets it, so two identical purchases made on purpose stay two writes.
import { ApiError } from "@/lib/api";

const KEY = "finnos:pending-intents";
const TTL_MS = 24 * 60 * 60 * 1000;

type Store = Record<string, { id: string; at: number }>;

function read(): Store {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Store;
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v && now - v.at < TTL_MS));
  } catch {
    return {};
  }
}

function write(store: Store) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable: the write still runs, only without retry identity.
  }
}

/** Canonical JSON so key order never changes the intent identity. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** True when the request may have reached the server and must be retried with the same id. */
export function isUncertain(error: unknown): boolean {
  if (!(error instanceof ApiError)) return !(error instanceof Error && error.message.startsWith("FINNOS_"));
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

/** Run `send` with the intent's operation id; keep the id only while the outcome is uncertain. */
export async function withIntent<T>(uid: string, kind: string, payload: unknown, send: (operationId: string) => Promise<T>): Promise<T> {
  const key = `${uid}|${kind}|${canonical(payload)}`;
  const store = read();
  const id = store[key]?.id ?? crypto.randomUUID();
  store[key] = { id, at: store[key]?.at ?? Date.now() };
  write(store);
  try {
    const result = await send(id);
    const after = read();
    delete after[key];
    write(after);
    return result;
  } catch (error) {
    if (!isUncertain(error)) {
      const after = read();
      delete after[key];
      write(after);
    }
    throw error;
  }
}
