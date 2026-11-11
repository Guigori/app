/** Keeps the app preferences the same on every device signed in to the account.
 *  Local storage stays the source while offline; the account copy is read on open and
 *  updated (debounced) after each change. The menu width stays per device on purpose. */
import { apiGet, apiPut } from "@/lib/api";
import { getMode } from "@/lib/mode";

const SYNCED = {
  navigation: { storage: "finnos:navigation-preferences:v2", event: "finnos-navigation-preferences" },
  home: { storage: "finnos:home-preferences:v1", event: "finnos-home-preferences" },
  // Início and Análise as the person arranged them (lib/insights/layout): analyses, sizes, order.
  widgets: { storage: "finnos:widgets:v1", event: "finnos-widgets" },
  register_default: { storage: "finnos:register-default:v1", event: "finnos-register-default" },
  // What the user taught FINNOS IA (lib/finnMemory), so it knows them on every device.
  finn_memory: { storage: "finnos:finn-memory:v1", event: "finnos-finn-memory" },
  // How the Home chart was left (lib/chartPreferences): view, period, series.
  chart: { storage: "finnos:chart-preferences:v1", event: "finnos-chart-preferences" },
  // Light/dark (next-themes keeps it under "theme").
  theme: { storage: "theme", event: "finnos-theme" },
} as const;
type Key = keyof typeof SYNCED;

let applying = false;
let timer: number | undefined;

function readLocal(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, { storage }] of Object.entries(SYNCED)) {
    const value = localStorage.getItem(storage);
    if (value !== null) values[key] = value;
  }
  return values;
}

function schedulePush() {
  if (applying || getMode() !== "account") return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { void apiPut("/preferences", { values: readLocal() }).catch(() => undefined); }, 1500);
}

/** Pull the account copy once, apply what differs, then follow local changes. */
export function startPreferencesSync(): () => void {
  if (getMode() !== "account") return () => undefined;
  void apiGet<{ values: Partial<Record<Key, string>> }>("/preferences").then(({ values }) => {
    applying = true;
    try {
      for (const [key, value] of Object.entries(values) as Array<[Key, string]>) {
        const target = SYNCED[key];
        if (!target || typeof value !== "string" || localStorage.getItem(target.storage) === value) continue;
        localStorage.setItem(target.storage, value);
        window.dispatchEvent(new Event(target.event));
      }
    } finally {
      applying = false;
    }
    // First device on the account: upload what this one has.
    if (!Object.keys(values).length && Object.keys(readLocal()).length) schedulePush();
  }).catch(() => undefined);
  const events = Object.values(SYNCED).map((s) => s.event);
  events.forEach((e) => window.addEventListener(e, schedulePush));
  return () => events.forEach((e) => window.removeEventListener(e, schedulePush));
}
