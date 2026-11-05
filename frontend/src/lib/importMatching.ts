/** De-para between imported statement lines and what is already registered.
 *  Each line gets a score from date, value, name, category and time; strong matches are
 *  likely duplicates, medium ones go to the user to decide (same, different or merge). */
import type { Transaction } from "@/types/finnos";

export type MatchLevel = "duplicate" | "similar" | "new";

export interface MatchInput {
  id: string;
  date: string;
  value: number;
  type: "receita" | "despesa";
  description: string;
  category_id?: string | null;
  time?: string | null;
}

export interface ImportMatch {
  level: MatchLevel;
  score: number;
  existing: Transaction | null;
  reasons: string[];
}

const GENERIC = new Set(["compra", "pagamento", "pix", "debito", "credito", "transferencia", "enviado", "recebido", "cartao", "parcela", "boleto", "ted", "doc", "com", "para", "de", "do", "da", "no", "na"]);

const tokens = (text: string) =>
  new Set(text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !GENERIC.has(t) && !/^\d+$/.test(t)));

export function nameSimilarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const t of x) if ([...y].some((u) => u === t || (t.length >= 4 && (u.startsWith(t) || t.startsWith(u))))) common++;
  return common / Math.min(x.size, y.size);
}

const dayDiff = (a: string, b: string) => Math.round(Math.abs(new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86_400_000);

const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Score one line against one existing transaction (0 = unrelated, 1 = same). */
export function scorePair(row: MatchInput, tx: Transaction): { score: number; reasons: string[] } {
  if (tx.type !== row.type) return { score: 0, reasons: [] };
  const days = dayDiff(row.date, tx.date);
  const diff = Math.abs(tx.value - row.value);
  const relative = diff / Math.max(row.value, 0.01);
  if (days > 3 || (relative > 0.1 && diff > 2)) return { score: 0, reasons: [] };
  const reasons: string[] = [];
  let score = 0;
  if (days === 0) { score += 0.35; reasons.push("mesma data"); }
  else if (days === 1) { score += 0.25; reasons.push("1 dia de diferença"); }
  else { score += 0.1; reasons.push(`${days} dias de diferença`); }
  if (diff < 0.005) { score += 0.35; reasons.push("mesmo valor"); }
  else if (relative <= 0.01 || diff <= 0.5) { score += 0.25; reasons.push(`valor quase igual (${money(tx.value)})`); }
  else if (relative <= 0.05) { score += 0.12; reasons.push(`valor parecido (${money(tx.value)})`); }
  else score += 0.05;
  const name = nameSimilarity(row.description, tx.name);
  if (name >= 0.5) { score += 0.2; reasons.push("nome parecido"); }
  else if (name > 0) score += 0.1;
  if (row.category_id && row.category_id === tx.category_id) { score += 0.1; reasons.push("mesma categoria"); }
  if (row.time && tx.created_at?.slice(0, 10) === tx.date) {
    const created = new Date(tx.created_at);
    const [h, m] = row.time.split(":").map(Number);
    if (Math.abs(created.getHours() * 60 + created.getMinutes() - (h * 60 + m)) <= 120) { score += 0.05; reasons.push("horário próximo"); }
  }
  return { score: Math.min(1, Math.round(score * 100) / 100), reasons };
}

export const DUPLICATE_SCORE = 0.8;
export const SIMILAR_SCORE = 0.5;

/** Best match for every line; one registered transaction is matched to at most one line. */
export function matchImportRows(rows: MatchInput[], existing: Transaction[]): Map<string, ImportMatch> {
  const pairs: Array<{ rowId: string; tx: Transaction; score: number; reasons: string[] }> = [];
  for (const row of rows) for (const tx of existing) {
    const { score, reasons } = scorePair(row, tx);
    if (score >= SIMILAR_SCORE) pairs.push({ rowId: row.id, tx, score, reasons });
  }
  pairs.sort((a, b) => b.score - a.score);
  const result = new Map<string, ImportMatch>();
  const usedTx = new Set<string>();
  for (const pair of pairs) {
    if (result.has(pair.rowId) || usedTx.has(pair.tx.id)) continue;
    usedTx.add(pair.tx.id);
    result.set(pair.rowId, { level: pair.score >= DUPLICATE_SCORE ? "duplicate" : "similar", score: pair.score, existing: pair.tx, reasons: pair.reasons });
  }
  for (const row of rows) if (!result.has(row.id)) result.set(row.id, { level: "new", score: 0, existing: null, reasons: [] });
  return result;
}
