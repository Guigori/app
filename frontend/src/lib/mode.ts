// Two ways to use FINNOS:
//  - "account": everything lives on the server behind an e-mail-verified login;
//  - "local":   nothing leaves this browser (no signup, no server records).
// The flag below is the single switch the data layer reads.

const KEY = "finnos:mode";

export type AppMode = "account" | "local";

export function getMode(): AppMode {
  return window.localStorage.getItem(KEY) === "local" ? "local" : "account";
}

export function isLocalMode(): boolean {
  return getMode() === "local";
}

export function enableLocalMode(): void {
  window.localStorage.setItem(KEY, "local");
}

export function disableLocalMode(): void {
  window.localStorage.removeItem(KEY);
}
