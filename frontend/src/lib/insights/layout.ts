/** How the person arranged Início and Análise: which analyses, in which size and order. Synced to the account. */
import { useMemo, useSyncExternalStore } from "react";
import { insightById, type WidgetConfig, type WidgetSize } from "@/lib/insights/registry";
import { ANALYSIS_RELEASE, ANALYSIS_TOP, DAILY_RELEASE, FEATURED, FEATURED_RELEASE } from "@/lib/insights/catalogDefs";

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
  const home: Array<[string, WidgetSize]> = [["descobertas", "M"], ["analise-do-dia", "M"], ["gastar-hoje", "S"], ["fatura-que-vem", "S"], ["ate-salario", "S"], ["em-aberto", "S"], ["previsao-saldo", "L"], ["resultado-mes", "M"], ["radar", "M"], ["orcamento", "M"], ["semana-que-vem", "M"], ["contas-fixas", "M"], ["metas", "M"], ["categorias", "L"]];
  let hidden: string[] = [];
  // People who hid Radar or the categories in the old "Modificar painel" keep them hidden.
  try { hidden = (JSON.parse(localStorage.getItem(OLD_HOME_KEY) ?? "{}").hidden ?? []) as string[]; } catch { hidden = []; }
  const oldName: Record<string, string> = { radar: "radar", categorias: "categories", "contas-fixas": "fixed", "fatura-que-vem": "cards" };
  return {
    inicio: home.filter(([id]) => !hidden.includes(oldName[id] ?? "")).map(([id, size], i) => ({ key: `d${i}`, id, size })),
    analise: [...ANALYSIS_TOP, ["renda", "M"], ["taxa-poupanca", "M"], ["categorias-subiram", "L"], ["maiores-gastos", "L"], ["previsao-saldo", "M"], ["reserva", "M"], ["regra-50-30-20", "L"], ["fixo-x-variavel", "M"], ["assinaturas", "M"], ["onde-compra", "L"], ["faturas", "L"]].map(([id, size], i) => ({ key: `a${i}`, id, size: size as WidgetSize })),
  };
}

/** Only analyses that still exist, in a size they accept. */
function clean(list: unknown): PlacedWidget[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((w) => {
    const def = w && typeof w === "object" ? insightById((w as PlacedWidget).id) : undefined;
    if (!def) return [];
    const p = w as PlacedWidget;
    // "Extra grande" was retired: it becomes Grande.
    const size = p.size === "XL" ? "L" : p.size;
    return [{ key: typeof p.key === "string" ? p.key : newKey(), id: def.id, size: def.sizes.includes(size) ? size : def.defaultSize, config: p.config && typeof p.config === "object" ? p.config : undefined }];
  });
}

/**
 * People who already arranged their screens get the new featured analyses once: on Início they go right after the
 * small tiles at the top, on Análise at the end. Removing them afterwards sticks (the release is remembered).
 */
export function offerFeatured(layouts: Layouts): Layouts {
  const add = (list: PlacedWidget[], items: Array<[string, WidgetSize]>, at: number) => {
    const fresh = items.filter(([id]) => !list.some((w) => w.id === id)).map(([id, size]) => ({ key: newKey(), id, size }));
    return [...list.slice(0, at), ...fresh, ...list.slice(at)];
  };
  const top = add(layouts.inicio, FEATURED.inicio.filter(([id]) => id === "descobertas"), 0);
  const smallTop = top.findIndex((w, i) => i > 0 && w.size !== "S");
  return { inicio: add(top, FEATURED.inicio.filter(([id]) => id !== "descobertas"), smallTop < 0 ? top.length : smallTop), analise: add(layouts.analise, FEATURED.analise, layouts.analise.length) };
}

/** The Análise board gets what used to be fixed on the tab, at the top (only the ones not there yet). */
export function offerAnalysisTop(layouts: Layouts): Layouts {
  const fresh = ANALYSIS_TOP.filter(([id]) => !layouts.analise.some((w) => w.id === id)).map(([id, size]) => ({ key: newKey(), id, size: size as WidgetSize }));
  return { ...layouts, analise: [...fresh, ...layouts.analise] };
}

export function offerDaily(layouts: Layouts): Layouts {
  if (layouts.inicio.some((w) => w.id === "analise-do-dia")) return layouts;
  const at = layouts.inicio.findIndex((w) => w.id === "descobertas") + 1;
  const item = { key: newKey(), id: "analise-do-dia", size: "M" as WidgetSize };
  return { ...layouts, inicio: [...layouts.inicio.slice(0, at), item, ...layouts.inicio.slice(at)] };
}

export function readLayouts(): Layouts {
  const base = defaultLayouts();
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as (Partial<Layouts> & { offered?: string[] }) | null;
    if (!raw) return base;
    const layouts = { inicio: raw.inicio ? clean(raw.inicio) : base.inicio, analise: raw.analise ? clean(raw.analise) : base.analise };
    const offered = raw.offered ?? [];
    let next = layouts;
    if (!offered.includes(FEATURED_RELEASE)) next = offerFeatured(next);
    if (!offered.includes(ANALYSIS_RELEASE)) next = offerAnalysisTop(next);
    if (!offered.includes(DAILY_RELEASE)) next = offerDaily(next);
    if ([FEATURED_RELEASE, ANALYSIS_RELEASE, DAILY_RELEASE].every((r) => offered.includes(r))) return layouts;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...next, offered: [FEATURED_RELEASE, ANALYSIS_RELEASE, DAILY_RELEASE] }));
    return next;
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
  localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...next, offered: [FEATURED_RELEASE, ANALYSIS_RELEASE, DAILY_RELEASE] }));
  snapshot = JSON.stringify(next);
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}

export function resetLayout(surface: Surface) { saveLayout(surface, defaultLayouts()[surface]); }

export function useLayout(surface: Surface): PlacedWidget[] {
  const raw = useSyncExternalStore(subscribe, read, () => JSON.stringify(defaultLayouts()));
  // Same snapshot → same array, so screens can depend on it without looping.
  return useMemo(() => (JSON.parse(raw) as Layouts)[surface], [raw, surface]);
}
