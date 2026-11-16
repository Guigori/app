/**
 * Firestore's daily free quota running out (server answers 503 with code "quota_exhausted" and `retry_at`).
 *
 * Until `retry_at` the app stops asking the server for data (nothing would load and every retry is wasted),
 * shows the last data kept on this device marked as not current, and tells the person when it comes back.
 */
import { useSyncExternalStore } from "react";

const KEY = "finnos:quota-until";
const listeners = new Set<() => void>();
let staleShown = false;

export const QUOTA_CODE = "quota_exhausted";

function read(): number {
  try {
    const until = Number(window.localStorage.getItem(KEY) ?? 0);
    return Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

/** When the server reopens (ms since epoch), or 0 when it is not blocked. */
export function quotaBlockedUntil(now = Date.now()): number {
  const until = read();
  return until > now ? until : 0;
}

function emit() {
  for (const listener of listeners) listener();
}

export function markQuotaExhausted(retryAt: unknown, now = Date.now()): void {
  const parsed = typeof retryAt === "string" ? Date.parse(retryAt) : NaN;
  // Without a usable time, back off for 15 minutes instead of hammering the server.
  const until = Number.isFinite(parsed) && parsed > now ? Math.min(parsed, now + 26 * 3600_000) : now + 15 * 60_000;
  try { window.localStorage.setItem(KEY, String(until)); } catch { /* memory only */ }
  emit();
}

export function clearQuotaBlock(): void {
  staleShown = false;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  emit();
}

export function isQuotaBody(body: unknown): body is { code: string; retry_at?: string } {
  return !!body && typeof body === "object" && (body as { code?: unknown }).code === QUOTA_CODE;
}

export function isQuotaError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { status?: unknown }).status === 503
    && isQuotaBody((error as { body?: unknown }).body);
}

/** A screen is showing data kept on this device because the server is blocked. */
export function noteStaleShown(): void {
  if (staleShown) return;
  staleShown = true;
  emit();
}

export function staleWasShown(): boolean {
  return staleShown;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function useQuotaBlock(): { until: number; stale: boolean } {
  const until = useSyncExternalStore(subscribe, () => quotaBlockedUntil(), () => 0);
  const stale = useSyncExternalStore(subscribe, staleWasShown, () => false);
  return { until, stale };
}
