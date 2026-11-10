/** Links and texts for setting up the Apple Pay automation. */

const ICLOUD_SHORTCUT = /^https:\/\/www\.icloud\.com\/shortcuts\/[A-Za-z0-9]+$/;

/**
 * The ready-made "Enviar ao FINNOS" shortcut, with the Wallet automation inside (iOS 26), shared
 * through iCloud and set in VITE_SHORTCUT_ICLOUD_URL. Null when not set, or when the value is not
 * an icloud.com shortcut link, so a typo never sends people somewhere else.
 *
 * The shortcut is the same for everyone and carries NO code: each person's code reaches their
 * own iPhone through connectShortcutUrl, never through the shared link.
 */
export function readyShortcutUrl(value?: string): string | null {
  const link = (value ?? "").trim();
  return ICLOUD_SHORTCUT.test(link) ? link : null;
}

/** The official shortcut's exact name: Shortcuts runs it by name. */
export const SHORTCUT_NAME = "FINNOS Apple Pay";

/**
 * Runs the person's installed FINNOS shortcut with their fresh code as input. The shortcut sees
 * a text starting with "fns_", saves it on the iPhone and answers "iPhone conectado". The code
 * never shows on screen and is never copied.
 */
export function connectShortcutUrl(code: string, name: string = SHORTCUT_NAME): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(code)}`;
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
