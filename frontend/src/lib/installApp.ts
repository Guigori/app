/** Installing FINNOS on the phone: which kind of device this is, whether it is already installed,
 *  and when the offer was last turned down. */
export type InstallPlatform = "ios-safari" | "ios-other" | "android" | "other";

const DISMISSED_KEY = "finnos:install-dismissed-at";
const QUIET_DAYS = 14;

export function installPlatform(ua: string = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): InstallPlatform {
  // iPadOS reports a Mac user agent; touch support tells them apart.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? "ios-other" : "ios-safari";
  if (/Android/.test(ua)) return "android";
  return "other";
}

export function isInstalled(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/** Offer again only after two weeks without installing. */
export function shouldOffer(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY) || 0);
    return !at || now - at > QUIET_DAYS * 86_400_000;
  } catch {
    return true;
  }
}

export function rememberDismissed(now = Date.now()): void {
  try { localStorage.setItem(DISMISSED_KEY, String(now)); } catch { /* private mode: it simply asks again */ }
}
