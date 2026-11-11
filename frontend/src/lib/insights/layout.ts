/** How the person arranged Início and Análise: which analyses, in which size and order. Synced to the account. */
import { useMemo, useSyncExternalStore } from "react";
import { insightById, type WidgetConfig, type WidgetSize } from "@/lib/insights/registry";

export type Surface = "inicio" | "analise";
export interface PlacedWidget { key: string; id: string; size: WidgetSize; config?: WidgetConfig }
export type Layouts = Record<Surface, PlacedWidget[]>;

export const LAYOUT_KEY = "finnos:widgets:v1";
export const LAYOUT_EVENT = "finnos-widgets";
const OLD_HOME_KEY = "finnos:home-preferences:v1";

let counter = 0;
export const newKey = () => `w${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Default Início: today's room to spend, the next bill, the month's forecast, the week, fixed bills, categories, Radar. */
export function defaultLayouts(): Layouts {
  const home: Array<[string, WidgetSize]> = [["gastar-hoje", "S"], ["fatura-que-vem", "S"], ["previsao-saldo", "L"], ["semana-que-vem", "M"], ["contas-fixas", "M"], ["categorias", "L"], ["radar", "L"]];
  let hidden: string[] = [];
  // People who hid Radar or the categories in the old "Modificar painel" keep them hidden.
  try { hidden = (JSON.parse(localStorage.getItem(OLD_HOME_KEY) ?? "{}").hidden ?? []) as string[]; } catch { hidden = []; }
  const oldName: Record<string, string> = { radar: "radar", categorias: "categories", "contas-fixas": "fixed", "fatura-que-vem": "cards" };
  return {
    inicio: home.filter(([id]) => !hidden.includes(oldName[id] ?? "")).map(([id, size], i) => ({ key: `d${i}`, id, size })),
    analise: [["previsao-saldo", "M"], ["faturas", "L"]].map(([id, size], i) => ({ key: `a${i}`, id, size: size as WidgetSize })),
  };
}

/** Only analyses that still exist, in a size they accept. */
function clean(list: unknown): PlacedWidget[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((w) => {
    const def = w && typeof w === "object" ? insightById((w as PlacedWidget).id) : undefined;
    if (!def) return [];
    const p = w as PlacedWidget;
    return [{ key: typeof p.key === "string" ? p.key : newKey(), id: def.id, size: def.sizes.includes(p.size) ? p.size : def.defaultSize, config: p.config && typeof p.config === "object" ? p.config : undefined }];
  });
}

export function readLayouts(): Layouts {
  const base = defaultLayouts();
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layouts> | null;
    if (!raw) return base;
    return { inicio: raw.inicio ? clean(raw.inicio) : base.inicio, analise: raw.analise ? clean(raw.analise) : base.analise };
  } catch { return base; }
}

let snapshot = "";
const read = () => (snapshot ||= JSON.stringify(readLayouts()));
function subscribe(cb: () => void) {
  const on = () => { snapshot = JSON.stringify(readLayouts()); cb(); };
  window.addEventListener(LAYOUT_EVENT, on);
  window.addEventListener("storage", on);
  return () => { window.removeEventListener(LAYOUT_EVENT, on); window.removeEventListener("storage", on); };
}

export function saveLayout(surface: Surface, widgets: PlacedWidget[]) {
  const next = { ...readLayouts(), [surface]: widgets };
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
  snapshot = JSON.stringify(next);
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}

export function resetLayout(surface: Surface) { saveLayout(surface, defaultLayouts()[surface]); }

export function useLayout(surface: Surface): PlacedWidget[] {
  const raw = useSyncExternalStore(subscribe, read, () => JSON.stringify(defaultLayouts()));
  // Same snapshot → same array, so screens can depend on it without looping.
  return useMemo(() => (JSON.parse(raw) as Layouts)[surface], [raw, surface]);
}
