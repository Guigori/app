/** Helpers shared by every statement/invoice import (onboarding and Configurações → Dados). */
/** Stable file digest: the same file always yields the same operation IDs (no double import). */
export async function fingerprint(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
