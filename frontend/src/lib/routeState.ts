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
  const storageKey = `${PREFIX}${key}:${name}`;
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initial === "function" ? (initial as () => T)() : initial;
    const saved = read<T>(storageKey);
    // A value of another shape (older version, other screen) is ignored, never trusted.
    const sameShape = fallback === null || fallback === undefined || typeof saved.value === typeof fallback;
    return saved.found && sameShape && saved.value !== null ? (saved.value as T) : fallback;
  });
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* private mode: nothing to restore */ }
  }, [storageKey, value]);
  return [value, setValue];
}

/** True when this screen was saved before for this history entry (coming back to it). */
export function useIsRestoring(): boolean {
  const { key } = useLocation();
  const restoring = useRef<boolean | null>(null);
  if (restoring.current === null) {
    try {
      restoring.current = Object.keys(sessionStorage).some((k) => k.startsWith(`${PREFIX}${key}:`));
    } catch {
      restoring.current = false;
    }
  }
  return restoring.current;
}
