import { Capacitor } from "@capacitor/core";

/** True quando o app roda dentro do casco nativo (Capacitor), false no navegador/PWA. */
export const isNative = (): boolean => Capacitor.isNativePlatform();

export const platform = (): "ios" | "android" | "web" => Capacitor.getPlatform() as "ios" | "android" | "web";

/** Base da API: relativa na web; absoluta (VITE_API_BASE) no app nativo, onde não há mesma origem. */
export const apiBase = (): string => {
  const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "";
  return isNative() && base ? `${base}/api` : "/api";
};

/** Service worker só na web: no esquema capacitor:// ele não roda. */
export const serviceWorkerSupported = (): boolean => !isNative() && typeof navigator !== "undefined" && "serviceWorker" in navigator;
