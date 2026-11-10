/** Per-history-entry screen state, so "Voltar" returns to exactly where the user was
 *  (month, tab, selected day, view…). Stored in sessionStorage under the router's
 *  location key: a new visit starts fresh, going back restores it. */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useLocation } from "react-router-dom";

const PREFIX = "finnos:route:";

function read<T>(key: string): { found: boolean; value?: T } {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? { found: false } : { found: true, value: JSON.parse(raw) as T };
  } catch {
    return { found: false };
  }
}

/** `name` must be unique app-wide (use "screen:field"), since screens can share a history entry. */
export function useRouteState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const { key } = useLocation();
  // A page opened from the address bar or reloaded always has key "default": treat it as a
  // fresh visit (the link's own parameters win), never as a history entry to restore.
  const persistent = key !== "default";
  const storageKey = `${PREFIX}${key}:${name}`;
  const load = (): T => {
    const fallback = typeof initial === "function" ? (initial as () => T)() : initial;
    const saved = persistent ? read<T>(storageKey) : { found: false as const };
    // A value of another shape (older version, other screen) is ignored, never trusted.
    const sameShape = fallback === null || fallback === undefined || typeof saved.value === typeof fallback;
    return saved.found && sameShape && saved.value !== null ? (saved.value as T) : fallback;
  };
  const [value, setValue] = useState<T>(load);
  // The same screen can stay mounted while the history entry changes (a link to itself, Voltar):
  // a saved entry brings its own value back; a new one keeps what is on screen until its link applies.
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    if (persistent && read<T>(storageKey).found) setValue(load());
  }
  useEffect(() => {
    if (!persistent) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* private mode: nothing to restore */ }
  }, [persistent, storageKey, value]);
  return [value, setValue];
}

/** True when this screen was saved before for this history entry (coming back to it). */
export function useIsRestoring(): boolean {
  const { key } = useLocation();
  // Decided once per history entry, not once per mount: a screen that stays mounted while a
  // link opens a new entry of it must apply that link's parameters.
  const restoring = useRef<{ key: string; value: boolean } | null>(null);
  if (restoring.current?.key !== key) {
    let value = false;
    if (key !== "default") {
      try { value = Object.keys(sessionStorage).some((k) => k.startsWith(`${PREFIX}${key}:`)); } catch { value = false; }
    }
    restoring.current = { key, value };
  }
  return restoring.current.value;
}
