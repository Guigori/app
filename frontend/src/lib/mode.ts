// FINNOS session modes:
//  - "account": everything lives on the server behind an e-mail-verified login;
//  - "local":   nothing leaves this browser (no signup, no server records).
//  - "demo": browser-only sample data, separate from personal local records.
// The flag below is the single switch the data layer reads.

const KEY = "finnos:mode";

export type AppMode = "account" | "local" | "demo";

export function getMode(): AppMode {
  const mode = window.localStorage.getItem(KEY);
  return mode === "local" || mode === "demo" ? mode : "account";
}

export function isLocalMode(): boolean {
  return getMode() !== "account";
}

export function enableLocalMode(): void {
  window.localStorage.setItem(KEY, "local");
}

export function disableLocalMode(): void {
  window.localStorage.removeItem(KEY);
}

/** Demo uses the browser engine with its own storage, preserving personal records. */
export function enableDemoMode(): void {
  window.localStorage.setItem(KEY, "demo");
}
