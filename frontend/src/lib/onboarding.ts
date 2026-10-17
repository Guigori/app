import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { getMode } from "@/lib/mode";

export type OnboardingStatus = "legacy" | "not_started" | "in_progress" | "skipped" | "completed";
export type OnboardingBudgetMode = "503020" | "personalizado";
export interface OnboardingPercentages {
  necessidades: number;
  desejos: number;
  metas: number;
}
export interface OnboardingState {
  version: number;
  status: OnboardingStatus;
  step: number;
  income_cents: number | null;
  budget_mode: OnboardingBudgetMode;
  budget_percentages: OnboardingPercentages;
  first_entry_seen: boolean;
  tour_seen: boolean;
}
export type OnboardingUpdate = Partial<Pick<OnboardingState,
  "status" | "step" | "income_cents" | "budget_mode" | "budget_percentages" | "first_entry_seen" | "tour_seen">>;

export const emptyOnboarding: OnboardingState = {
  version: 1, status: "legacy", step: 0, income_cents: null,
  budget_mode: "503020",
  budget_percentages: { necessidades: 50, desejos: 30, metas: 20 },
  first_entry_seen: false, tour_seen: false,
};

export async function fetchOnboarding(): Promise<OnboardingState> {
  if (getMode() !== "account") return emptyOnboarding;
  return apiGet<OnboardingState>("/onboarding");
}

export async function startOnboarding(): Promise<OnboardingState> {
  if (getMode() !== "account") return emptyOnboarding;
  return apiPost<OnboardingState>("/onboarding/start");
}

export async function saveOnboarding(update: OnboardingUpdate): Promise<OnboardingState> {
  if (getMode() !== "account") return { ...emptyOnboarding, ...update };
  return apiPatch<OnboardingState>("/onboarding", update);
}

export async function destinationAfterAuthentication(isNewAccount = false): Promise<string> {
  try {
    if (isNewAccount) await startOnboarding();
    const state = await fetchOnboarding();
    return state.status === "not_started" || state.status === "in_progress" ? "/onboarding" : "/";
  } catch {
    // Never discard a verified session because onboarding is temporarily unavailable.
    // The Home retains an explicit resume link for an incomplete configuration.
    return isNewAccount ? "/onboarding" : "/";
  }
}
