import { useSyncExternalStore } from "react";
import { MAIN_NAV, MENU_SLUGS, NAV_GROUPS, type NavItem } from "@/components/layout/nav";

const KEY = "finnos:navigation-preferences:v2";
const EVENT = "finnos-navigation-preferences";

/** How each person arranged the bottom bar (phone) and the menu (phone drawer and computer sidebar). */
export type NavigationPreferences = {
  /** Bottom-bar tabs, in order: 2 to 4, Início always first. */
  mobile: string[];
  /** Kept for older saved settings; the computer has no tab strip anymore. */
  web: string[];
  /** The Conversa button (phone / computer). */
  aiMobile: boolean;
  aiWeb: boolean;
  /** Menu items the person chose to hide. */
  menuHiddenMobile: string[];
  menuHiddenWeb: string[];
  /** Order of the computer menu (items keep their section). */
  webOrder: string[];
  /** On the phone, leave out of the menu what is already in the bottom bar. */
  menuDedupe: boolean;
  /** The + button beside the bottom bar. */
  fab: boolean;
  /** Values and alerts beside the menu items (2 vencendo, R$ 89/mês…). */
  menuBadges: boolean;
};

const HOME = "inicio";
export const MOBILE_MIN = 2;
export const MOBILE_MAX = 4;
const MOBILE_DEFAULT = ["inicio", "transacoes", "orcamento", "contas"];
const WEB_DEFAULT = ["inicio", "transacoes", "analise", "orcamento", "categorias", "contas"];

function validSlugs() {
  return new Set(MAIN_NAV.filter((item) => !item.soon).map((item) => item.slug));
}

export function defaultNavigationPreferences(): NavigationPreferences {
  return {
    mobile: [...MOBILE_DEFAULT], web: [...WEB_DEFAULT], aiMobile: true, aiWeb: true,
    menuHiddenMobile: [], menuHiddenWeb: [], webOrder: [...MENU_SLUGS],
    menuDedupe: true, fab: true, menuBadges: true,
  };
}

const strings = (value: unknown, allowed: Set<string>): string[] | null =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && allowed.has(x)).filter((x, i, a) => a.indexOf(x) === i) : null;

export function getNavigationPreferences(): NavigationPreferences {
  if (typeof window === "undefined") return defaultNavigationPreferences();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<NavigationPreferences>;
    const valid = validSlugs();
    const menu = new Set(MENU_SLUGS);
    const withHome = (list: string[]) => [HOME, ...list.filter((x) => x !== HOME)];
    // "fluxo" (cash flow) now lives inside Fluxo; saved shortcuts move to Análise.
    const migrated = Array.isArray(raw.mobile) ? raw.mobile.map((x) => (x === "fluxo" ? "analise" : x)) : null;
    const mobile = withHome(strings(migrated, valid) ?? MOBILE_DEFAULT).slice(0, MOBILE_MAX);
    const savedOrder = strings(raw.webOrder, menu) ?? [];
    return {
      mobile: mobile.length >= MOBILE_MIN ? mobile : [...MOBILE_DEFAULT],
      web: withHome(strings(raw.web, valid) ?? WEB_DEFAULT),
      aiMobile: raw.aiMobile !== false,
      aiWeb: raw.aiWeb !== false,
      menuHiddenMobile: strings(raw.menuHiddenMobile, menu) ?? [],
      menuHiddenWeb: strings(raw.menuHiddenWeb, menu) ?? [],
      // Items added to the menu after the order was saved go to the end.
      webOrder: [...savedOrder, ...MENU_SLUGS.filter((x) => !savedOrder.includes(x))],
      menuDedupe: raw.menuDedupe !== false,
      fab: raw.fab !== false,
      menuBadges: raw.menuBadges !== false,
    };
  } catch {
    return defaultNavigationPreferences();
  }
}

let snapshot = "";
function readSnapshot() {
  // Always reconcile with localStorage. This also fixes stale preferences when
  // the page loaded before a previous setting was written.
  const current = JSON.stringify(getNavigationPreferences());
  if (current !== snapshot) snapshot = current;
  return snapshot;
}
function subscribe(callback: () => void) {
  const handler = () => { snapshot = JSON.stringify(getNavigationPreferences()); callback(); };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => { window.removeEventListener(EVENT, handler); window.removeEventListener("storage", handler); };
}

export function saveNavigationPreferences(next: NavigationPreferences) {
  const normalized = {
    ...next,
    mobile: [HOME, ...next.mobile.filter((x) => x !== HOME)].slice(0, MOBILE_MAX),
    web: [HOME, ...next.web.filter((x) => x !== HOME)],
  };
  localStorage.setItem(KEY, JSON.stringify(normalized));
  snapshot = JSON.stringify(getNavigationPreferences());
  window.dispatchEvent(new Event(EVENT));
}

export function resetNavigationPreferences() {
  localStorage.removeItem(KEY);
  snapshot = JSON.stringify(getNavigationPreferences());
  window.dispatchEvent(new Event(EVENT));
}

export function useNavigationPreferences(): NavigationPreferences {
  const raw = useSyncExternalStore(subscribe, readSnapshot, () => JSON.stringify(defaultNavigationPreferences()));
  return JSON.parse(raw) as NavigationPreferences;
}

export function navItemsFor(slugs: string[]): NavItem[] {
  const bySlug = new Map(MAIN_NAV.map((item) => [item.slug, item]));
  return slugs.map((slug) => bySlug.get(slug)).filter((item): item is NavItem => Boolean(item));
}

/**
 * The menu as one person sees it on this kind of screen: sections in order, without what they hid
 * and (on the phone, if they chose so) without what is already in the bottom bar.
 */
export function menuFor(prefs: NavigationPreferences, surface: "mobile" | "web"): { label: string | null; items: NavItem[] }[] {
  const hidden = new Set(surface === "mobile" ? prefs.menuHiddenMobile : prefs.menuHiddenWeb);
  if (surface === "mobile" && prefs.menuDedupe) prefs.mobile.forEach((slug) => hidden.add(slug));
  const rank = (slug: string) => (surface === "web" ? prefs.webOrder.indexOf(slug) : MENU_SLUGS.indexOf(slug));
  return NAV_GROUPS
    .map((group) => ({
      label: group.label,
      items: navItemsFor([...group.items].sort((a, b) => rank(a) - rank(b)).filter((slug) => !hidden.has(slug))),
    }))
    .filter((group) => group.items.length > 0);
}
