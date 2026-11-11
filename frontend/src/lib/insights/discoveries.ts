/**
 * Descobertas FINNOS: out of every analysis of the catalog, what matters now — what changed, what is late, what
 * passed a limit, what weighs most. Each discovery keeps the analysis it came from, so a tap opens it.
 */
import type { Finding } from "@/lib/insights/invoices";
import { READERS, type Chart, type Ctx, type Reading } from "@/lib/insights/catalog";

export interface Discovery { id: string; title: string; text: string; tone: Finding["tone"]; chart?: Chart; score: number }

/** The analyses that can surface a discovery (the heavy ones that read every transaction stay out). */
export const DISCOVERY_SOURCES = Object.keys(READERS).filter((id) => !READERS[id].needs.includes("allTx"));
export const DISCOVERY_NEEDS = [...new Set(DISCOVERY_SOURCES.flatMap((id) => READERS[id].needs)), "dashboard"];

const WEIGHT: Record<Finding["tone"], number> = { bad: 3, good: 1.2, info: 1 };
/** Some readings matter more when they light up (money late, the month going negative). */
const BOOST: Record<string, number> = { "em-aberto": 1.5, "ate-salario": 1, "resultado-mes": 1, "categorias-subiram": 0.8, "regra-50-30-20": 0.6, "limite-cartoes": 0.6, "maiores-gastos": 0.4 };
const TITLE: Record<string, string> = {
  "em-aberto": "Contas em aberto", "ate-salario": "Até a próxima renda", "resultado-mes": "Como o mês deve fechar", "categorias-subiram": "O que mais subiu",
  "regra-50-30-20": "Regra 50/30/20", "limite-cartoes": "Limite dos cartões", "maiores-gastos": "Maior gasto do mês", "taxa-poupanca": "Quanto você guardou",
  reserva: "Reserva de emergência", "fixo-x-variavel": "Fixo x variável", "onde-compra": "Onde você mais compra", assinaturas: "Assinaturas", "gastos-pequenos": "Gastos pequenos",
  "semanas-do-mes": "Esta semana", "cartao-x-conta": "Cartão ou conta", "saidas-por-conta": "Saídas por conta", "patrimonio-liquido": "Patrimônio líquido", "ticket-medio": "Gasto por compra", "a-revisar": "Para revisar",
};

const pctBR = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function discoveries(ctx: Ctx, limit = 6): Discovery[] {
  const out: Discovery[] = [];
  // What weighed most this month (the category slice), the way the person already reads it on Início.
  const top = ctx.dashboard?.categories?.[0];
  if (top && (ctx.dashboard?.expense ?? 0) > 0) {
    out.push({
      id: "categorias", title: "O que mais pesou neste mês", tone: top.percent >= 50 ? "bad" : "info",
      text: `${top.name} representa ${pctBR(top.percent)} dos seus gastos neste período: ${ctx.money(top.total)}.`,
      chart: { type: "donut", center: top.name, slices: ctx.dashboard!.categories.map((c) => ({ id: c.category_id ?? c.name, name: c.name, value: c.total, color: c.color })) },
      score: top.percent >= 50 ? 3.2 : 2.2,
    });
  }
  for (const id of DISCOVERY_SOURCES) {
    let r: Reading;
    try { r = READERS[id].read(ctx); } catch { continue; }
    if (r.empty || !r.findings.length) continue;
    const best = [...r.findings].sort((a, b) => WEIGHT[b.tone] - WEIGHT[a.tone])[0];
    const worse = r.vs?.c && r.vs.c.better === false && Math.abs(r.vs.c.pct ?? 0) >= 0.15 ? 0.8 : 0;
    out.push({ id, title: TITLE[id] ?? r.tile, text: best.text, tone: best.tone, chart: r.chart, score: WEIGHT[best.tone] + worse + (best.tone === "bad" ? BOOST[id] ?? 0 : (BOOST[id] ?? 0) / 3) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
