/** Beta access: invite requests, feedback and automatic error reports (read in the Firebase console).
 *  None of these carry financial data: only what the person typed, the screen path and the device. */
import { ApiError, apiPost } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";

export const INVITE_MESSAGE = "Seu e-mail ainda não foi liberado no beta do FINNOS. Peça seu convite e avisamos por e-mail.";

export function isInviteError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && (error.body as { detail?: unknown } | null)?.detail === "convite";
}

export const appVersion = (): string =>
  ((import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined) || "dev").slice(0, 7);

export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : "Outro";
  const browser = /CriOS|Chrome/.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Navegador";
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ? " · app" : "";
  return `${os} · ${browser}${standalone} · ${window.innerWidth}×${window.innerHeight}`;
}

export interface WaitlistInput { name: string; phone: string; email: string; consent: boolean; website?: string; source?: string }
export const joinWaitlist = (input: WaitlistInput) => apiPost<{ ok: boolean; created?: boolean }>("/public/waitlist", input);

export type FeedbackKind = "bug" | "ideia" | "elogio" | "duvida" | "outro";
export interface FeedbackInput { kind: FeedbackKind; message: string; mood?: number | null; screen?: string }
export const sendFeedback = (input: FeedbackInput) =>
  apiPost<{ ok: boolean }>("/feedback", { ...input, screen: input.screen ?? window.location.pathname, version: appVersion(), device: deviceLabel() });

// --- Automatic error reports -------------------------------------------------------------

const sent = new Map<string, number>();
let reportsThisSession = 0;

/** Sends an app error to the beta inbox: once per message every 10 minutes, at most 20 per session.
 *  Local mode and the demo never send anything. */
export function reportClientError(error: unknown, kind: "error" | "rejection" | "render" | "api" = "error"): void {
  try {
    if (isLocalMode() || reportsThisSession >= 20) return;
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Erro desconhecido");
    if (err.name === "ApiError" || err.message === "FINNOS_SESSION_CHANGED") return;
    if (/ResizeObserver loop|Load failed|NetworkError|Failed to fetch|AbortError/i.test(err.message)) return;
    const key = err.message.slice(0, 120);
    const now = Date.now();
    if ((sent.get(key) ?? 0) > now - 10 * 60_000) return;
    sent.set(key, now);
    reportsThisSession += 1;
    void apiPost("/client-errors", {
      message: err.message.slice(0, 500) || err.name,
      stack: err.stack?.slice(0, 4000) ?? null,
      kind,
      screen: window.location.pathname,
      version: appVersion(),
      device: deviceLabel(),
    }).catch(() => undefined);
  } catch {
    // Reporting must never break the app.
  }
}

export function installErrorCapture(): void {
  window.addEventListener("error", (event) => reportClientError(event.error ?? event.message, "error"));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason, "rejection"));
}

// --- Where the person was before opening support ------------------------------------------

const LAST_SCREEN = "finnos:last-screen";
export function rememberScreen(path: string): void {
  if (path.startsWith("/configuracoes")) return;
  try { sessionStorage.setItem(LAST_SCREEN, path); } catch { /* private mode */ }
}
export function lastScreen(): string | null {
  try { return sessionStorage.getItem(LAST_SCREEN); } catch { return null; }
}
