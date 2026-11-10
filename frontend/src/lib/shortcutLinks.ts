/** Links and texts for setting up the Apple Pay automation. */

const ICLOUD_SHORTCUT = /^https:\/\/www\.icloud\.com\/shortcuts\/[A-Za-z0-9]+$/;

/**
 * The ready-made "Enviar ao FINNOS" shortcut, with the Wallet automation inside (iOS 26), shared
 * through iCloud and set in VITE_SHORTCUT_ICLOUD_URL. Null when not set, or when the value is not
 * an icloud.com shortcut link, so a typo never sends people somewhere else.
 *
 * The shortcut must ASK for the connection code on import: a link with someone's code inside
 * would send everyone's purchases to that account.
 */
export function readyShortcutUrl(value?: string): string | null {
  const link = (value ?? "").trim();
  return ICLOUD_SHORTCUT.test(link) ? link : null;
}

/** Opens the Shortcuts app itself. */
export const SHORTCUTS_APP = "shortcuts://";

/** The three fields the Wallet automation sends, and what to pick for each in the Shortcuts app. */
export const AUTOMATION_FIELDS = [
  { key: "valor", pick: "Valor", hint: "o valor da compra" },
  { key: "descricao", pick: "Comerciante", hint: "onde você pagou" },
  { key: "carteira", pick: "Cartão ou Passe", hint: "o cartão da Carteira usado" },
] as const;

export const pendingEndpoint = (origin: string) => `${origin}/api/shortcuts/pendentes`;

/** The value of the Authorization header. Without a fresh code, a placeholder that says what goes there. */
export const bearerValue = (code?: string | null) => `Bearer ${code && code.startsWith("fns_") ? code : "fns_…"}`;

/** The code from "https://endereço|fns_…", the part the header needs. */
export function codeFromConnection(connection: string | null): string | null {
  const code = connection?.split("|")[1]?.trim();
  return code && code.startsWith("fns_") ? code : null;
}
