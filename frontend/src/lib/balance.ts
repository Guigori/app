import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "finnos:hide-balance";
const EVENT = "finnos:balance-visibility";

/** Shared hide/show toggle for financial values, persisted in localStorage so the
 *  choice follows the user across screens (and survives reloads). */
export function useBalanceHidden() {
  const [hidden, setHidden] = useState<boolean>(
    () => typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1",
  );

  useEffect(() => {
    const onChange = (event: Event) => setHidden((event as CustomEvent<boolean>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const toggle = useCallback(() => {
    // The next value is computed outside the state updater: dispatching the sync event
    // from inside it would setState on other subscribers mid-render (React warning).
    const next = window.localStorage.getItem(STORAGE_KEY) !== "1";
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    setHidden(next);
    window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: next }));
  }, []);

  return { hidden, toggle };
}
