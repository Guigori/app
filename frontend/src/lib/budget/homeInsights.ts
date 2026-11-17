/**
 * Orçamento · início: "O que importa agora". Uma lista curta, em ordem de urgência, só com o que pede uma decisão ou
 * muda o mês, e cada item com a ação que resolve. Tudo sai do MonthView (nada é gravado aqui) e respeita os avisos
 * ligados em Configurar.
 */
import type { MonthView, PlanItem } from "@/lib/budget/monthView";

export type InsightTone = "expense" | "warn" | "info" | "good";
export interface HomeInsight {
  id: string;
  tone: InsightTone;
  title: string;
  text?: string;
  action?: { label: string; to: string };
}

/** Reminders of the month that are due: from the day before until 2 days after, while not marked as done. */
export function dueReminders(reminders: { id: string; date: string; text: string; done?: boolean }[], today: string) {
  return reminders.filter((r) => !r.done && days(r.date, today) >= -1 && days(r.date, today) <= 2).sort((a, b) => a.date.localeCompare(b.date));
}

type On = Partial<Record<"categoria" | "limite80" | "estimativa" | "fatura" | "recebimento" | "parecido", boolean>>;

const r2 = (v: number) => Math.round(v * 100) / 100;
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86400000);
const names = (list: PlanItem[]) => list.length === 1 ? list[0].name : list.length === 2 ? `${list[0].name} e ${list[1].name}` : `${list[0].name}, ${list[1].name} e mais ${list.length - 2}`;

/** pace: projection per category from the Gastos view (fixed bills are not spread over the days). */
export function buildHomeInsights(v: MonthView, money: (n: number) => string, on: On = {}, pace?: Record<string, number>): HomeInsight[] {
  if (v.when === "past") return [];
  const is = (k: keyof On) => on[k] !== false;
  const out: HomeInsight[] = [];
  const m = v.month, today = v.today, current = v.when === "current";
  const open = v.items.filter((i) => i.state !== "realizado");

  // 1. Money that will not be enough: the balance goes below zero before the month ends.
  if (current && v.lowest && v.lowest.value < 0) {
    out.push({ id: "negativo", tone: "expense", title: `O saldo fica negativo em ${dm(v.lowest.date)}`, text: `Chega a ${money(v.lowest.value)} se tudo o que está previsto sair. Veja o que dá para adiar.`, action: { label: "Ver compromissos", to: `/orcamento/compromissos?mes=${m}` } });
  }
  // 2. Bills already late.
  const late = current ? open.filter((i) => i.type === "despesa" && i.date < today) : [];
  if (late.length && is("estimativa")) {
    const one = late.length === 1 ? late[0] : null;
    out.push({ id: "vencidas", tone: "expense", title: one ? `${one.name} venceu em ${dm(one.date)}` : `${late.length} contas vencidas`, text: one ? `${money(one.value)} · ${one.state === "estimativa" ? "estimativa" : "agendado"} no Fluxo. Pagou? Registre para o livre ficar certo.` : `${names(late)} · ${money(late.reduce((s, i) => s + i.value, 0))} no total.`,
      action: one?.transaction_id ? { label: "Abrir no Fluxo", to: `/transacoes?month=${one.date.slice(0, 7)}&highlight=${one.transaction_id}` } : { label: "Ver compromissos", to: `/orcamento/compromissos?mes=${m}` } });
  }
  // 3. Categories over the limit, then the ones that will pass at this pace.
  if (is("categoria")) {
    const over = v.categories.filter((c) => c.over > 0).sort((a, b) => b.over - a.over);
    if (over.length) out.push({ id: "passou", tone: "expense", title: over.length === 1 ? `${over[0].name} passou ${money(over[0].over)} do limite` : `${over.length} categorias passaram do limite`, text: over.length === 1 ? `${money(over[0].spent)} de ${money(over[0].limit)}.` : over.slice(0, 3).map((c) => `${c.name} +${money(c.over)}`).join(" · "), action: { label: "Ver gastos", to: `/orcamento/gastos?mes=${m}` } });
  }
  if (current && is("limite80") && v.daily.elapsed >= 0.2) {
    const ahead = v.categories.filter((c) => c.over <= 0 && c.spent > 0).map((c) => ({ c, proj: r2(pace?.[c.category_id] ?? c.spent / v.daily.elapsed) })).filter((x) => x.proj > x.c.limit * 1.05).sort((a, b) => (b.proj - b.c.limit) - (a.proj - a.c.limit));
    if (ahead.length) {
      const p = ahead[0];
      out.push({ id: "ritmo", tone: "warn", title: `Nesse ritmo, ${p.c.name} passa ${money(p.proj - p.c.limit)}`, text: `Vai a ${money(p.proj)} no mês (limite ${money(p.c.limit)}). Até ${money(Math.max(0, (p.c.limit - p.c.spent) / Math.max(1, v.daysLeft)))} por dia mantém dentro.${ahead.length > 1 ? ` ${ahead.length - 1} outra${ahead.length > 2 ? "s" : ""} no mesmo caminho.` : ""}`, action: { label: "Ver gastos", to: `/orcamento/gastos?mes=${m}` } });
    }
  }
  // 4. What is due in the next 3 days.
  const soon = current ? open.filter((i) => i.type === "despesa" && i.date >= today && days(today, i.date) <= 3) : [];
  if (soon.length) {
    const first = soon[0], d = days(today, first.date);
    out.push({ id: "em-breve", tone: "info", title: soon.length === 1 ? `${first.name} vence ${d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`}` : `${soon.length} contas nos próximos 3 dias`, text: soon.length === 1 ? money(first.value) : `${names(soon)} · ${money(soon.reduce((s, i) => s + i.value, 0))}`, action: { label: "Ver compromissos", to: `/orcamento/compromissos?mes=${m}` } });
  }
  // 5. Decisions waiting: repeated bills and subscriptions only count after approval.
  if (v.suggestions.length) {
    out.push({ id: "revisar", tone: "info", title: `${v.suggestions.length} ${v.suggestions.length === 1 ? "conta espera" : "contas esperam"} você decidir`, text: `${names(v.suggestions)}: repetidas ou de Assinaturas. Só entram no livre se você aprovar.`, action: { label: "Revisar", to: `/orcamento/proximo?mes=${m}` } });
  }
  // 6. Income that is only expected.
  const est = open.filter((i) => i.type === "receita" && i.state === "estimativa");
  if (current && est.length && is("recebimento")) {
    const sum = est.reduce((s, i) => s + i.value, 0);
    out.push({ id: "receber", tone: "warn", title: `${est.length === 1 ? est[0].name : `${est.length} recebimentos`} ainda ${est.length === 1 ? "é estimativa" : "são estimativas"}`, text: `${money(sum)} fora do livre até cair. Se não cair, o mês termina com ${money(v.endBalance - sum)}.`, action: { label: "Ver compromissos", to: `/orcamento/compromissos?mes=${m}` } });
  }
  // 7. Card invoice closing soon (from the month's alerts, which know the cards).
  for (const a of v.alerts) if (a.id.startsWith("close:") && is("fatura")) out.push({ id: a.id, tone: "info", title: "Fatura fecha em breve", text: a.text, action: { label: "Abrir o cartão", to: `/cartoes/${a.id.slice(6)}` } });

  if (!out.length && current) {
    out.push({ id: "tudo-certo", tone: "good", title: "Tudo dentro do previsto", text: v.daily.limit > 0 && v.daily.allowance > 0 ? `Dá para gastar até ${money(v.daily.allowance)} por dia nos limites até o fim do mês.` : "Nenhuma conta vencida, nenhum limite estourado." });
  }
  return out;
}
