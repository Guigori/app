/** Helpers shared by every statement/invoice import (onboarding and Configurações → Dados). */
import type { ImportRow } from "@/lib/importFinancial";

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();

/** Stable file digest: the same file always yields the same operation IDs (no double import). */
export async function fingerprint(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** Same day, same value, same direction and a similar description as something already registered. */
export function isLikelyDuplicate(row: Pick<ImportRow, "date" | "value" | "type" | "description">, existing: Array<{ date: string; value: number; name: string; type: string }>): boolean {
  const desc = normalize(row.description).slice(0, 6);
  return existing.some((tx) =>
    tx.date === row.date &&
    Math.abs(tx.value - row.value) < 0.005 &&
    tx.type === row.type &&
    (!desc || normalize(tx.name).includes(desc)),
  );
}

export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
