/**
 * Análise do dia: one analysis of the library that is not on the person's boards, chosen for today. What asks for
 * action comes first; among the relevant ones the pick changes every day, so the library gets known little by little.
 */
import type { Finding } from "@/lib/insights/invoices";
import { READERS, type Ctx } from "@/lib/insights/catalog";

const WEIGHT: Record<Finding["tone"], number> = { bad: 3, info: 1.2, good: 1 };
/** Same text → same number, so the day's pick is stable through the day. */
const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function dailyPick(ctx: Ctx, placed: string[], today: string, exclude: string[] = []): string | null {
  const skip = new Set([...placed, ...exclude, "analise-do-dia", "descobertas"]);
  const scored = Object.keys(READERS).filter((id) => !skip.has(id)).flatMap((id) => {
    try {
      const r = READERS[id].read(ctx);
      if (r.empty) return [];
      const best = Math.max(0, ...r.findings.map((f) => WEIGHT[f.tone]));
      const worse = r.vs?.c && r.vs.c.better === false ? 0.6 : 0;
      // The daily turn: up to 1.5 points that change every day, so the same analysis does not win forever.
      const turn = (hash(`${id}|${today}`) % 1000) / 1000 * 1.5;
      return [{ id, score: best + worse + turn }];
    } catch { return []; }
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id ?? null;
}
