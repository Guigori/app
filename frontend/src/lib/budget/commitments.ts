/**
 * Orçamento · tela 9 (Compromissos): o que já está assumido no mês, lido dos módulos de origem.
 * Só mostra. Contas e receitas continuam no Fluxo, faturas em Cartões, assinaturas em Assinaturas e aportes em Metas.
 * Sugestões (contas repetidas do mês anterior, assinaturas projetadas) só entram depois de aprovadas no plano.
 */
import type { Flow } from "@/types/finnos";
import { isSuggestion, stateOf, type MonthView, type PlanItem } from "@/lib/budget/monthView";

export type CommitmentKind = "conta" | "receber" | "cartao" | "assinatura" | "meta";
export type CommitmentFilter = "todos" | "pagar" | "receber" | "cartao";

export interface Commitment {
  key: string;
  kind: CommitmentKind;
  name: string;
  date: string;
  value: number;
  state: PlanItem["state"];
  /** Already happened (paid or received). */
  done: boolean;
  late: boolean;
  /** Days until it is due (negative when late). */
  days: number;
  origin: string;
  status: string;
  transaction_id?: string | null;
  card_id?: string | null;
  subscription_id?: string | null;
  goal_id?: string | null;
}

export interface FutureCommitment { key: string; name: string; note: string; value: number; monthly: boolean; source: "fluxo" | "cartao" }

export interface CommitmentsView {
  items: Commitment[];
  toPay: number;
  late: number;
  toReceive: number;
  nextReceive: Commitment | null;
  paid: number;
  pendingSuggestions: number;
  week: { date: string; items: Commitment[] }[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86400000);

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function originOf(i: PlanItem): string {
  if (i.source === "cartao") return "Cartões · fatura";
  if (i.source === "assinatura") return "Assinaturas";
  return i.type === "receita" ? "Fluxo · receita" : "Fluxo · conta";
}

export function buildCommitments(view: MonthView, goals: { id: string; name: string; value: number }[]): CommitmentsView {
  const today = view.today;
  const lastDay = `${view.month}-${String(view.daysInMonth).padStart(2, "0")}`;
  const items: Commitment[] = view.items.map((i) => {
    const kind: CommitmentKind = i.type === "receita" ? "receber" : i.source === "cartao" ? "cartao" : i.source === "assinatura" ? "assinatura" : "conta";
    const done = i.state === "realizado";
    const days = between(today, i.date);
    const late = !done && view.when === "current" && days < 0;
    const when = days === 0 ? "hoje" : days === 1 ? "amanhã" : `em ${days} dias`;
    const status = done
      ? `Realizado · ${i.type === "receita" ? "entrou na" : "saiu da"} conta`
      : `${i.state === "estimativa" ? "Estimativa" : "Agendado"} · ${late ? `venceu há ${-days} ${-days === 1 ? "dia" : "dias"}` : view.when !== "current" ? `dia ${i.date.slice(8)}` : i.type === "receita" ? `cai ${when}` : `vence ${when}`}`;
    return { key: i.key, kind, name: i.name, date: i.date, value: i.value, state: i.state, done, late, days, origin: originOf(i), status,
      transaction_id: i.transaction_id, card_id: i.card_id, subscription_id: i.subscription_id };
  });
  // Contributions to metas that the month's plan set aside: done in Metas, shown here as part of what is assumed.
  for (const g of goals) {
    if (g.value <= 0) continue;
    items.push({ key: `meta:${g.id}`, kind: "meta", name: `Meta ${g.name}`, date: lastDay, value: r2(g.value), state: "agendado", done: false, late: false,
      days: between(today, lastDay), origin: "Metas · aporte do plano", status: "Agendado · até o fim do mês", goal_id: g.id });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  const openOut = items.filter((x) => !x.done && x.kind !== "receber" && x.kind !== "meta");
  const receive = items.filter((x) => !x.done && x.kind === "receber");
  const week = view.when === "current" ? Array.from({ length: 7 }, (_, k) => {
    const date = addDays(today, k);
    return { date, items: items.filter((x) => !x.done && (x.date === date || (k === 0 && x.late))) };
  }) : [];
  return {
    items,
    toPay: r2(openOut.reduce((s, x) => s + x.value, 0)),
    late: openOut.filter((x) => x.late).length,
    toReceive: r2(receive.reduce((s, x) => s + x.value, 0)),
    nextReceive: receive[0] ?? null,
    paid: r2(items.filter((x) => x.done && x.kind !== "receber").reduce((s, x) => s + x.value, 0)),
    pendingSuggestions: view.suggestions.length,
    week,
  };
}

export function passes(c: Commitment, f: CommitmentFilter): boolean {
  if (f === "todos") return true;
  if (f === "pagar") return !c.done && (c.kind === "conta" || c.kind === "cartao" || c.kind === "meta");
  if (f === "receber") return c.kind === "receber";
  return c.kind === "cartao" || c.kind === "assinatura";
}

/** Scheduled in the next months (Fluxo and card installments): grouped by name, with how long they go on. */
export function buildFuture(flows: { month: string; flow: Flow }[]): FutureCommitment[] {
  const by = new Map<string, { name: string; value: number; months: string[]; dates: string[]; installment: boolean; source: "fluxo" | "cartao" }>();
  for (const { month, flow } of flows) {
    for (const u of flow.upcoming ?? []) {
      if (u.type !== "despesa" || isSuggestion(u) || stateOf(u) !== "agendado") continue;
      const installment = u.kind === "parcela";
      const base = installment ? u.name.replace(/\s*\(?\d+\s*\/\s*\d+\)?\s*$/, "").trim() : u.name;
      const k = `${base}|${installment ? "p" : u.date}`;
      const cur = by.get(k) ?? { name: base, value: u.value, months: [], dates: [], installment, source: "fluxo" as const };
      if (!cur.months.includes(month)) cur.months.push(month);
      cur.dates.push(u.date);
      by.set(k, cur);
    }
  }
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return [...by.entries()].map(([key, x]) => {
    const last = x.months.sort().at(-1)!;
    const monthly = x.installment || x.months.length > 1;
    const note = monthly
      ? `Agendado · ${x.months.length} ${x.installment ? (x.months.length === 1 ? "parcela" : "parcelas") : "meses"} até ${MONTHS[Number(last.slice(5)) - 1]}`
      : `Agendado para ${x.dates[0].slice(8)}/${x.dates[0].slice(5, 7)}`;
    return { key, name: x.name, note, value: r2(x.value), monthly, source: x.source };
  }).sort((a, b) => Number(b.monthly) - Number(a.monthly) || b.value - a.value);
}
