import { useSyncExternalStore } from "react";

const KEY = "finnos:home-preferences:v1";
const EVENT = "finnos-home-preferences";

export const HOME_MODULES = [
  { id: "metrics", label: "Receitas, despesas e saldo" },
  { id: "radar", label: "Radar" },
  { id: "categories", label: "Pra onde foi o dinheiro?" },
  { id: "recent", label: "Transações recentes" },
  { id: "budget", label: "Planejamento 50/30/20" },
] as const;

export type HomeModuleId = (typeof HOME_MODULES)[number]["id"];
export type HomePreferences = { order: HomeModuleId[]; hidden: HomeModuleId[] };

const DEFAULT_ORDER: HomeModuleId[] = HOME_MODULES.map((item) => item.id);

export function defaultHomePreferences(): HomePreferences {
  return { order: [...DEFAULT_ORDER], hidden: [] };
}

export function getHomePreferences(): HomePreferences {
  if (typeof window === "undefined") return defaultHomePreferences();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<HomePreferences>;
    const valid = new Set<HomeModuleId>(DEFAULT_ORDER);
    const saved = Array.isArray(raw.order) ? raw.order.filter((id): id is HomeModuleId => valid.has(id as HomeModuleId)) : [];
    const order = [...saved, ...DEFAULT_ORDER.filter((id) => !saved.includes(id))];
    const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((id): id is HomeModuleId => valid.has(id as HomeModuleId)) : [];
    return { order, hidden };
  } catch {
    return defaultHomePreferences();
  }
}

let snapshot = JSON.stringify(defaultHomePreferences());
function readSnapshot() { return snapshot; }
function subscribe(callback: () => void) {
  const handler = () => { snapshot = JSON.stringify(getHomePreferences()); callback(); };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => { window.removeEventListener(EVENT, handler); window.removeEventListener("storage", handler); };
}

export function saveHomePreferences(next: HomePreferences) {
  localStorage.setItem(KEY, JSON.stringify(next));
  snapshot = JSON.stringify(getHomePreferences());
  window.dispatchEvent(new Event(EVENT));
}

export function resetHomePreferences() {
  localStorage.removeItem(KEY);
  snapshot = JSON.stringify(getHomePreferences());
  window.dispatchEvent(new Event(EVENT));
}

export function useHomePreferences(): HomePreferences {
  const raw = useSyncExternalStore(subscribe, readSnapshot, () => JSON.stringify(defaultHomePreferences()));
  return JSON.parse(raw) as HomePreferences;
}
