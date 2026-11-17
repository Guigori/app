/**
 * Orçamento settings: colchão na conta, avisos, modelos de limites e sugestões descartadas.
 * Kept on the device (works offline) and synced to the account like the other preferences (lib/preferencesSync,
 * key "budget"), so they are the same on every device. No financial data here.
 */
import { useEffect, useState } from "react";

const KEY = "finnos:budget-settings:v1";
const EVENT = "finnos-budget-settings";

export type BudgetAlertKind = "categoria" | "limite80" | "estimativa" | "fatura" | "recebimento" | "parecido" | "fechar" | "planejar";
export const ALERT_LABELS: Record<BudgetAlertKind, [string, string]> = {
  categoria: ["Categoria passou do limite", "Orçamento"],
  limite80: ["Categoria chegou a 80% do limite", "Orçamento"],
  estimativa: ["Estimativa venceu sem acontecer", "Fluxo"],
  fatura: ["Fatura do cartão vai fechar", "Carteira"],
  recebimento: ["Recebimento ainda é estimativa", "Fluxo"],
  parecido: ["Lançamento parecido com um previsto", "Fluxo"],
  fechar: ["Lembrar de fechar o mês (dias 1 a 10)", "Orçamento"],
  planejar: ["Lembrar de planejar o próximo mês (a partir do dia 20)", "Orçamento"],
};

export interface BudgetModel { id: string; name: string; note?: string; limits: Record<string, number>; created_at: string }
/** The person's own split of what comes in (like 50/30/20, but chosen): percentages that add up to 100. */
export interface BudgetSplit { necessidades: number; desejos: number; futuro: number }
export interface BudgetSettings {
  cushion: number;
  split: BudgetSplit | null;
  alerts: Record<BudgetAlertKind, boolean>;
  models: BudgetModel[];
  dismissed: string[];
}

const DEFAULTS: BudgetSettings = {
  cushion: 0,
  split: null,
  alerts: { categoria: true, limite80: true, estimativa: true, fatura: true, recebimento: true, parecido: true, fechar: true, planejar: true },
  models: [],
  dismissed: [],
};

export function validSplit(s: unknown): s is BudgetSplit {
  if (!s || typeof s !== "object") return false;
  const v = s as BudgetSplit;
  const parts = [v.necessidades, v.desejos, v.futuro];
  return parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 100) && Math.round(parts.reduce((a, b) => a + b, 0)) === 100;
}

export const splitLabel = (s: BudgetSplit) => `${s.necessidades}/${s.desejos}/${s.futuro}`;

export function budgetSettings(): BudgetSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<BudgetSettings>;
    return {
      cushion: Number.isFinite(raw.cushion) && (raw.cushion ?? 0) > 0 ? Number(raw.cushion) : 0,
      split: validSplit(raw.split) ? raw.split : null,
      alerts: { ...DEFAULTS.alerts, ...(raw.alerts ?? {}) },
      models: Array.isArray(raw.models) ? raw.models.filter((m) => m && typeof m.id === "string" && typeof m.name === "string").slice(0, 12) : [],
      dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.filter((x): x is string => typeof x === "string").slice(-150) : [],
    };
  } catch { return { ...DEFAULTS, alerts: { ...DEFAULTS.alerts } }; }
}

export function updateBudgetSettings(patch: Partial<BudgetSettings>): BudgetSettings {
  const next = { ...budgetSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT));
  return next;
}

/** The settings, following changes made on this device or arriving from the account. */
export function useBudgetSettings(): [BudgetSettings, (patch: Partial<BudgetSettings>) => void] {
  const [value, setValue] = useState(budgetSettings);
  useEffect(() => {
    const on = () => setValue(budgetSettings());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  return [value, (patch) => setValue(updateBudgetSettings(patch))];
}

// --- compatibility helpers used by the screens
export const budgetCushion = () => budgetSettings().cushion;
export const setBudgetCushion = (value: number) => updateBudgetSettings({ cushion: Math.max(0, value) });
export const dismissedMatches = () => budgetSettings().dismissed;
export const dismissMatch = (key: string) => updateBudgetSettings({ dismissed: [...budgetSettings().dismissed, key].slice(-150) });
