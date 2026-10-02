import { useCallback, useEffect, useState } from "react";

const HOME_VIEW_KEY = "finnos:home-view";
const HOME_VIEW_EVENT = "finnos:home-view-change";

export type HomeView = "cards" | "graficos";

/** How the Home summary is rendered — cards or charts. Persisted on the device so the
 *  choice survives reloads, and broadcast so every mounted consumer stays in sync. */
export function useHomeView() {
  const [view, setView] = useState<HomeView>(() =>
    typeof window !== "undefined" && window.localStorage.getItem(HOME_VIEW_KEY) === "graficos"
      ? "graficos"
      : "cards",
  );

  useEffect(() => {
    const onChange = (event: Event) => setView((event as CustomEvent<HomeView>).detail);
    window.addEventListener(HOME_VIEW_EVENT, onChange);
    return () => window.removeEventListener(HOME_VIEW_EVENT, onChange);
  }, []);

  const change = useCallback((next: HomeView) => {
    window.localStorage.setItem(HOME_VIEW_KEY, next);
    setView(next);
    window.dispatchEvent(new CustomEvent<HomeView>(HOME_VIEW_EVENT, { detail: next }));
  }, []);

  return { view, setView: change };
}
