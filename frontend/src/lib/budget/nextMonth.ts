/**
 * Orçamento · tela 3 (Planejar o próximo mês). The person decides what comes in, what is paid and what is kept:
 * - what they registered in Fluxo (pending, scheduled, installments) and card invoices start included;
 * - what the app only repeats or projects (a fixed bill from last month, a subscription charge) starts OUT and enters
 *   only when the person includes it. Nothing enters on its own.
 * Keeping money is always a meta (Metas confirms it); new forecasts are saved in Fluxo through its own form.
 */
import type { CreditCard, Flow } from "@/types/finnos";
import { isSuggestion, upcomingKey } from "@/lib/budget/monthView";

export interface PlanRow {
  key: string;
  name: string;
  date: string;
  value: number;
  type: "receita" | "despesa";
  origin: "fluxo" | "sugestao" | "cartao";
  note: string;
  on: boolean;
}

export type PlanTone = "nao-fecha" | "atencao" | "pode";

export interface NextMonthPlan {
  month: string;
  incomes: PlanRow[];
  bills: PlanRow[];
  inTotal: number;
  billTotal: number;
  saveTotal: number;
  rest: number;
  spend: number;
  habit: number;
  tone: PlanTone;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const NOTE = { pendente: "Estimativa no Fluxo", agendado: "Agendado no Fluxo", parcela: "Parcela que já vem", fixa: "Conta fixa no Fluxo", assinatura: "Assinatura" } as const;

export function buildNextMonthPlan({ month, flow, cards, approved = [], ignored = [], save = {}, habit }: {
  month: string; flow: Flow; cards: CreditCard[]; approved?: string[]; ignored?: string[]; save?: Record<string, number>; habit: number;
}): NextMonthPlan {
  const ok = new Set(approved), off = new Set(ignored);
  const rows: PlanRow[] = (flow.upcoming ?? []).map((u) => {
    const key = upcomingKey(u);
    const suggested = isSuggestion(u);
    return {
      key, name: u.name, date: u.date, value: r2(u.value), type: u.type,
      origin: suggested ? "sugestao" : "fluxo",
      note: suggested ? (u.kind === "assinatura" ? "Assinatura · inclua se vai acontecer" : "Repetida · inclua se vai acontecer") : NOTE[u.kind],
      on: suggested ? ok.has(key) : !off.has(key),
    };
  });
  for (const c of cards) {
    if (!c.active) continue;
    const due = c.payable_due && c.payable_due.slice(0, 7) === month ? { date: c.payable_due, value: c.payable_invoice ?? 0 }
      : c.next_due && c.next_due.slice(0, 7) === month ? { date: c.next_due, value: c.current_invoice } : null;
    if (!due || due.value <= 0) continue;
    const key = `card:${c.id}:${month}`;
    rows.push({ key, name: `Fatura ${c.name}`, date: due.date, value: r2(due.value), type: "despesa", origin: "cartao", note: "Carteira · compras e parcelas que já vêm", on: !off.has(key) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const incomes = rows.filter((r) => r.type === "receita");
  const bills = rows.filter((r) => r.type === "despesa");
  const inTotal = r2(incomes.filter((r) => r.on).reduce((s, r) => s + r.value, 0));
  const billTotal = r2(bills.filter((r) => r.on).reduce((s, r) => s + r.value, 0));
  const saveTotal = r2(Object.values(save).reduce((s, v) => s + Math.max(0, v), 0));
  const rest = r2(inTotal - billTotal);
  const spend = r2(rest - saveTotal);
  const tone: PlanTone = spend < 0 ? "nao-fecha" : spend < habit ? "atencao" : "pode";
  return { month, incomes, bills, inTotal, billTotal, saveTotal, rest, spend, habit: r2(habit), tone };
}

/** Toggling a row: a suggestion is approved or not; a registered row or invoice is kept or left out of this month. */
export function toggleDecision(row: PlanRow): "approve" | "ignore" | "undo" {
  if (row.origin === "sugestao") return row.on ? "undo" : "approve";
  return row.on ? "ignore" : "undo";
}
