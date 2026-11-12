/** Same rules as finnos/lib/statement_matching.py (local mode mirror). */
import type { Transaction } from "@/types/finnos";

export type LineLevel = "strong" | "probable" | "value_diff" | "only_statement" | "already" | "linked";
export interface MatchLine { index: number; date: string; description: string; cents: number; direction: "in" | "out"; fitid?: string | null; origin_key: string }
export interface LineResult { level: LineLevel; tx_id: string | null; reasons: string[] }

const DATE_TOLERANCE = 3;
const VALUE_DIFF_RATIO = 0.10;
const VALUE_DIFF_SAME_NAME = 0.25;
const GENERIC = new Set(["compra", "pagamento", "pix", "debito", "credito", "transferencia", "enviado", "enviada", "recebido",
  "recebida", "cartao", "parcela", "boleto", "ted", "doc", "com", "para", "de", "do", "da", "no", "na", "pagto", "pag", "transf", "conta"]);

const plain = (text: string) => (text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
const tokens = (text: string) => new Set(plain(text).replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w)));

export function nameSimilarity(a: string, b: string): number {
  if (plain(a) && plain(a) === plain(b)) return 1;
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const t of x) if ([...y].some((u) => u === t || (t.length >= 4 && (u.startsWith(t) || t.startsWith(u))))) common++;
  return common / Math.min(x.size, y.size);
}

export function originKey(uid: string, accountId: string, line: Omit<MatchLine, "origin_key" | "index">): string {
  return [uid, accountId, line.date, line.cents, line.direction, plain(line.description).replace(/\d{4,}/g, "#")].join("|");
}

const days = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
const toCents = (value: number) => Math.round(value * 100);

export function txEffect(tx: Transaction, accountId: string): ["in" | "out", number] | null {
  if (tx.status !== "pago") return null;
  const value = toCents(tx.value);
  if (tx.type === "transferencia") {
    if (tx.account_id === accountId) return ["out", value];
    if (tx.to_account_id === accountId) return ["in", value];
    return null;
  }
  if (tx.account_id !== accountId || tx.card_id) return null;
  return [tx.type === "receita" ? "in" : "out", value];
}

export function matchLines(lines: MatchLine[], txs: Transaction[], accountId: string, linked: Record<string, string> = {}) {
  const movements = new Map<string, { tx: Transaction; direction: "in" | "out"; value: number }>();
  for (const tx of txs) { const e = txEffect(tx, accountId); if (e) movements.set(tx.id, { tx, direction: e[0], value: e[1] }); }
  const results = new Map<number, LineResult>();
  const used = new Set<string>();
  for (const line of lines) {
    for (const key of [line.fitid, line.origin_key]) {
      const id = key ? linked[key] : undefined;
      if (id && movements.has(id) && !used.has(id)) { results.set(line.index, { level: "strong", tx_id: id, reasons: ["já conferido antes"] }); used.add(id); break; }
    }
  }
  type Pair = { score: number; index: number; txId: string; kind: "exact" | "value_diff"; d: number; sim: number };
  const pairs: Pair[] = [];
  for (const line of lines) {
    if (results.has(line.index)) continue;
    for (const [txId, m] of movements) {
      if (used.has(txId) || m.direction !== line.direction) continue;
      const d = days(line.date, m.tx.date);
      if (d > DATE_TOLERANCE) continue;
      const sim = nameSimilarity(line.description, m.tx.name);
      if (m.value === line.cents) pairs.push({ score: 0.6 + (d === 0 ? 0.25 : d === 1 ? 0.15 : 0.05) + 0.15 * sim, index: line.index, txId, kind: "exact", d, sim });
      else if (sim >= 0.5 && Math.abs(m.value - line.cents) <= (sim >= 0.99 ? VALUE_DIFF_SAME_NAME : VALUE_DIFF_RATIO) * Math.max(line.cents, 1))
        pairs.push({ score: 0.4 + 0.1 * sim, index: line.index, txId, kind: "value_diff", d, sim });
    }
  }
  for (const p of [...pairs].sort((a, b) => b.score - a.score)) {
    if (results.has(p.index) || used.has(p.txId)) continue;
    const exact = pairs.filter((q) => q.index === p.index && q.kind === "exact" && !used.has(q.txId));
    const reasons = [p.kind === "exact" ? "mesmo valor" : "valor diferente", p.d === 0 ? "mesma data" : `${p.d} dia(s) de diferença`];
    if (p.sim >= 0.5) reasons.push("nome parecido");
    if (p.kind === "value_diff") results.set(p.index, { level: "value_diff", tx_id: p.txId, reasons });
    else if (exact.length === 1 && (p.d === 0 || p.sim >= 0.5)) {
      const competing = pairs.some((q) => q.txId === p.txId && q.index !== p.index && q.kind === "exact" && !results.has(q.index));
      if (competing) reasons.push("outra linha do extrato também serve");
      results.set(p.index, { level: competing ? "probable" : "strong", tx_id: p.txId, reasons });
    } else {
      if (exact.length > 1) reasons.push(`${exact.length} lançamentos possíveis`);
      results.set(p.index, { level: "probable", tx_id: p.txId, reasons });
    }
    used.add(p.txId);
  }
  for (const line of lines) if (!results.has(line.index)) results.set(line.index, { level: "only_statement", tx_id: null, reasons: [] });
  const repeated: Record<string, string> = {};
  for (const [txId, m] of movements) {
    if (used.has(txId)) continue;
    for (const line of lines) {
      const r = results.get(line.index)!;
      if ((r.level === "strong" || r.level === "probable") && line.direction === m.direction && line.cents === m.value
        && days(line.date, m.tx.date) <= DATE_TOLERANCE && nameSimilarity(line.description, m.tx.name) >= 0.5) { repeated[txId] = r.tx_id!; break; }
    }
  }
  return { lines: results, onlyFinnos: [...movements.keys()].filter((id) => !used.has(id)), repeated };
}
