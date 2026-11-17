/**
 * Orçamento · tela 10 (Planos especiais): fases, progresso e o efeito no mês.
 * O plano só guarda datas, valor, limites e a meta ligada. O dinheiro fica em Metas (ou é o 13º) e os gastos vêm
 * do Fluxo. Nada entra sozinho: só nos meses em que a pessoa inclui o plano, o limite das categorias dele ganha o
 * valor do plano. O dinheiro sai da meta quando você o tirar em Metas.
 */
import type { Transaction } from "@/types/finnos";
import type { BudgetSpecial } from "@/lib/budget/server";

export type SpecialPhase = "Guardando" | "Pronto" | "Em andamento" | "Terminou";

export interface SpecialStatus {
  phase: SpecialPhase;
  /** 0..1: saved (before) or used (during/after). */
  percent: number;
  saved: number;
  spent: number;
  barLabel: string;
  hint: string;
  impact: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmtD = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;

/** Months left to save, counting the current one, until the month the plan starts (at least 1). */
export function monthsUntil(today: string, start: string): number {
  const n = (Number(start.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(start.slice(5, 7)) - Number(today.slice(5, 7));
  return Math.max(1, n);
}

export function monthlyFor(today: string, start: string, amount: number, alreadySaved = 0): number {
  return amount > alreadySaved ? Math.ceil((amount - alreadySaved) / monthsUntil(today, start)) : 0;
}

/** Spending of the plan's categories inside its dates (benefits included: they also pay the trip). */
export function spentIn(sp: Pick<BudgetSpecial, "start" | "end" | "categories">, transactions: Transaction[]): number {
  const cats = new Set(sp.categories.map((c) => c.category_id));
  return r2(transactions.filter((t) => t.type === "despesa" && t.status === "pago" && !t.balance_adjustment && t.date >= sp.start && t.date <= sp.end && t.category_id && cats.has(t.category_id))
    .reduce((s, t) => s + (t.installment ? (t.installment_value ?? t.value) : t.value), 0));
}

export function specialStatus(sp: BudgetSpecial, today: string, saved: number, spent: number, brl: (v: number) => string): SpecialStatus {
  const ended = sp.end < today, running = sp.start <= today && !ended;
  const ready = !running && !ended && (sp.source === "13" || saved >= sp.amount);
  const phase: SpecialPhase = ended ? "Terminou" : running ? "Em andamento" : ready ? "Pronto" : "Guardando";
  const using = running || ended;
  const percent = sp.amount > 0 ? Math.min(1, (using ? spent : sp.source === "13" ? sp.amount : saved) / sp.amount) : 0;
  const barLabel = using ? "Usado no período" : sp.source === "13" ? "Vem do 13º salário" : "Guardado na meta";
  const hint = ended
    ? (spent > sp.amount ? `Passou ${brl(spent - sp.amount)} do previsto.` : `Terminou com ${brl(sp.amount - spent)} sem usar.`)
    : running ? `Sobram ${brl(Math.max(0, sp.amount - spent))} até ${fmtD(sp.end)}.`
    : ready ? "Dinheiro pronto antes de começar."
    : `Faltam ${brl(sp.amount - saved)} até ${fmtD(sp.start)}.`;
  const impact = sp.source === "13"
    ? "Usa o 13º de dezembro. Só conta no orçamento do mês se você incluir: aí o limite das categorias do plano ganha o valor dele."
    : ended ? "Terminou: os limites voltaram ao de sempre. O que sobrou continua na meta, em Metas."
    : "Só conta no orçamento do mês se você incluir: aí o limite das categorias do plano ganha o valor dele. O dinheiro sai da meta quando você o tirar em Metas.";
  return { phase, percent, saved: r2(saved), spent, barLabel, hint, impact };
}

/** Months a plan touches (AAAA-MM), to include it month by month. */
export function specialMonths(sp: Pick<BudgetSpecial, "start" | "end">): string[] {
  const out: string[] = [];
  let m = sp.start.slice(0, 7);
  while (m <= sp.end.slice(0, 7) && out.length < 24) { out.push(m); const [y, n] = m.split("-").map(Number); m = n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, "0")}`; }
  return out;
}

/** Extra limit per category for a month, from the plans given (the caller passes only the ones included). */
export function specialLimitsFor(month: string, specials: BudgetSpecial[]): Record<string, number> {
  const first = `${month}-01`, last = `${month}-31`;
  const out: Record<string, number> = {};
  for (const sp of specials) {
    if (sp.start > last || sp.end < first) continue;
    for (const c of sp.categories) out[c.category_id] = r2((out[c.category_id] ?? 0) + c.limit);
  }
  return out;
}

export function validateSpecial(f: { name: string; start: string; end: string; amount: number; source: BudgetSpecial["source"]; goalSaved?: number }): string | null {
  if (!f.name.trim()) return "Dê um nome ao plano.";
  if (!(f.amount > 0)) return "Informe quanto vai custar.";
  if (!f.start || !f.end || f.end < f.start) return "A data final precisa ser depois da inicial.";
  if (f.source === "13" && f.start.slice(5, 7) !== "12") return "O 13º cai em dezembro. Para um plano em outra data, guarde numa meta.";
  if (f.source === "existente" && f.goalSaved === undefined) return "Escolha a meta.";
  return null;
}
