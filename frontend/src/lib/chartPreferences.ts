/**
 * How the person left the Home chart: kind of chart, period, series turned on. Kept on the
 * device (it survives closing the app) and synced to the account by lib/preferencesSync,
 * so the chart opens the same way next time and on the other devices.
 */
import { useCallback, useSyncExternalStore } from "react";

/** Periods of the Home chart, in menu order. */
export const CHART_RANGES = ["7 dias", "1 mês", "3 meses", "6 meses", "1 ano"];

const KEY = "finnos:chart-preferences:v1";
export const CHART_PREFERENCES_EVENT = "finnos-chart-preferences";
export const CHART_PREFERENCES_KEY = KEY;

export interface ChartPreferences {
  view?: string;
  interval?: string;
  series?: string[];
  projection?: string[];
  metrics?: string[];
}

function read(): ChartPreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ChartPreferences) : {};
  } catch {
    return {};
  }
}

let snapshot = "";
function readSnapshot() {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return snapshot; }
}
function subscribe(callback: () => void) {
  window.addEventListener(CHART_PREFERENCES_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(CHART_PREFERENCES_EVENT, callback); window.removeEventListener("storage", callback); };
}

export function saveChartPreference<K extends keyof ChartPreferences>(name: K, value: ChartPreferences[K]) {
  const next = { ...read(), [name]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    snapshot = JSON.stringify(next);
  } catch { /* private mode: keeps working for this visit */ }
  window.dispatchEvent(new Event(CHART_PREFERENCES_EVENT));
}

/** A string choice (view, period); anything not in `allowed` falls back to the default. */
export function pickOne<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A set of choices (series); unknown items are dropped; an empty result falls back. */
export function pickMany<T extends string>(value: unknown, allowed: readonly T[], fallback: T[], allowEmpty = false): T[] {
  if (!Array.isArray(value)) return fallback;
  const kept = value.filter((item): item is T => typeof item === "string" && (allowed as readonly string[]).includes(item));
  return kept.length || allowEmpty ? [...new Set(kept)] : fallback;
}

/** [value, setValue] kept in the chart preferences, validated on every read. */
export function useChartPreference<T>(name: keyof ChartPreferences, parse: (raw: unknown) => T): [T, (next: T) => void] {
  const raw = useSyncExternalStore(subscribe, readSnapshot, () => "");
  let stored: unknown;
  try { stored = raw ? (JSON.parse(raw) as ChartPreferences)[name] : undefined; } catch { stored = undefined; }
  const value = parse(stored);
  const set = useCallback((next: T) => saveChartPreference(name, next as ChartPreferences[typeof name]), [name]);
  return [value, set];
}
