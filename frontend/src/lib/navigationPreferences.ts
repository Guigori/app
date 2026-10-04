import { useSyncExternalStore } from "react";
import { MAIN_NAV, type NavItem } from "@/components/layout/nav";

const KEY = "finnos:navigation-preferences:v1";
const EVENT = "finnos-navigation-preferences";

export type NavigationPreferences = {
  mobile: string[];
  web: string[];
};

const HOME = "inicio";
const MOBILE_DEFAULT = ["inicio", "transacoes", "fluxo", "contas"];
const WEB_DEFAULT = MAIN_NAV.map((item) => item.slug);

function validSlugs() {
  return new Set(MAIN_NAV.filter((item) => !item.soon).map((item) => item.slug));
}

export function defaultNavigationPreferences(): NavigationPreferences {
  return { mobile: [...MOBILE_DEFAULT], web: [...WEB_DEFAULT] };
}

export function getNavigationPreferences(): NavigationPreferences {
  if (typeof window === "undefined") return defaultNavigationPreferences();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<NavigationPreferences>;
    const valid = validSlugs();
    const clean = (value: unknown, fallback: string[], max?: number) => {
      const source = Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && valid.has(x)) : fallback;
      const unique = [HOME, ...source.filter((x) => x !== HOME)].filter((x, i, a) => a.indexOf(x) === i);
      return max ? unique.slice(0, max) : unique;
    };
    return { mobile: clean(raw.mobile, MOBILE_DEFAULT, 4), web: clean(raw.web, WEB_DEFAULT) };
  } catch {
    return defaultNavigationPreferences();
  }
}

let snapshot = JSON.stringify(defaultNavigationPreferences());
function readSnapshot() {
  snapshot = JSON.stringify(getNavigationPreferences());
  return snapshot;
}
function subscribe(callback: () => void) {
  const handler = () => { snapshot = JSON.stringify(getNavigationPreferences()); callback(); };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => { window.removeEventListener(EVENT, handler); window.removeEventListener("storage", handler); };
}

export function saveNavigationPreferences(next: NavigationPreferences) {
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}

export function resetNavigationPreferences() {
  localStorage.removeItem(KEY);
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
