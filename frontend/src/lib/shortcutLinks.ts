/** Links and texts for setting up the Apple Pay automation. */

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
