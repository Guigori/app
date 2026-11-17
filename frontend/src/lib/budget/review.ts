/**
 * Fechar o mês e começar o próximo: a conferência item por item. Funções puras sobre o que já está nos módulos de
 * origem (Fluxo, Cartões, Assinaturas, Metas). Nada aqui grava: cada ação abre o registro onde ele vive.
 */
import type { SubscriptionItem, Transaction } from "@/types/finnos";
import type { FinnosGoal } from "@/lib/goals";
import type { CategoryLimit } from "@/lib/budget/monthView";
import type { PlanReminder } from "@/lib/budget/server";
import { addMonth } from "@/lib/format";

const r2 = (v: number) => Math.round(v * 100) / 100;
const amount = (t: Transaction) => (t.installment ? t.installment_value ?? t.value : t.value);
export const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(?\d+\s*\/\s*\d+\)?/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const lastDay = (m: string) => { const [y, mm] = m.split("-").map(Number); return `${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, "0")}`; };
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86400000);
const shift = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** planned/vsPlanned: the value when the month was planned (if it was), and the difference to it. */
export interface BillLine { tx: Transaction; paid: boolean; value: number; previous: number | null; delta: number | null; planned: number | null; vsPlanned: number | null }
export interface BillsReview { lines: BillLine[]; paid: BillLine[]; open: BillLine[]; changed: BillLine[]; total: number; paidTotal: number }

/** Bills (despesa) or incomes (receita) expected in the month: registered in Fluxo, fixed, recurring or still open. */
export function reviewBills(month: string, txs: Transaction[], prevTxs: Transaction[], type: "despesa" | "receita", expected: Record<string, number> = {}): BillsReview {
  const valid = (t: Transaction) => t.type === type && !t.invoice_payment && !t.balance_adjustment && !t.benefit_recharge && !t.card_id;
  const prevBy = new Map<string, number>();
  for (const t of prevTxs) if (valid(t) && t.status === "pago") prevBy.set(normName(t.name), (prevBy.get(normName(t.name)) ?? 0) + amount(t));
  const lines = txs
    .filter((t) => t.date.slice(0, 7) === month && valid(t) && (type === "receita" || t.fixed || !!t.recurrence_id || t.installment || t.status !== "pago"))
    .map((t) => {
      const previous = prevBy.has(normName(t.name)) ? r2(prevBy.get(normName(t.name))!) : null;
      const value = r2(amount(t));
      const planned = expected[`tx:${t.id}`] ?? null;
      return { tx: t, paid: t.status === "pago", value, previous, delta: previous != null ? r2(value - previous) : null, planned, vsPlanned: planned != null ? r2(value - planned) : null };
    })
    .sort((a, b) => Number(a.paid) - Number(b.paid) || a.tx.date.localeCompare(b.tx.date));
  const paid = lines.filter((l) => l.paid), open = lines.filter((l) => !l.paid);
  const changed = paid.filter((l) => (l.vsPlanned != null && Math.abs(l.vsPlanned) >= 0.01) || (l.delta != null && Math.abs(l.delta) >= Math.max(1, (l.previous ?? 0) * 0.02)));
  return { lines, paid, open, changed, total: r2(lines.reduce((s, l) => s + l.value, 0)), paidTotal: r2(paid.reduce((s, l) => s + l.value, 0)) };
}

export interface InstallmentLine { key: string; name: string; card: string; current: number; total: number; value: number; left: number; remaining: number; ends: string }

/** Card installments charged in the month: which one it was, how many are left and when the last one comes. */
export function reviewInstallments(month: string, txs: Transaction[]) {
  const lines: InstallmentLine[] = txs
    .filter((t) => t.date.slice(0, 7) === month && t.installment && (t.total_installments ?? 0) > 1 && t.type === "despesa")
    .map((t) => {
      const total = t.total_installments ?? 1, current = Math.min(total, t.current_installment ?? 1), value = r2(amount(t)), left = Math.max(0, total - current);
      return { key: t.id, name: t.name.replace(/\s*\(?\d+\s*\/\s*\d+\)?\s*$/, "").trim(), card: t.card_name ?? t.account_name ?? "", current, total, value, left, remaining: r2(left * value), ends: addMonth(month, left) };
    })
    .sort((a, b) => b.remaining - a.remaining);
  const invoices = txs.filter((t) => t.date.slice(0, 7) === month && t.invoice_payment).map((t) => ({ id: t.id, name: t.name, value: r2(t.value), date: t.date }));
  return {
    lines, invoices,
    monthTotal: r2(lines.reduce((s, l) => s + l.value, 0)),
    future: r2(lines.reduce((s, l) => s + l.remaining, 0)),
    lastEnd: lines.reduce((m, l) => (l.ends > m ? l.ends : m), month),
    ending: lines.filter((l) => l.left === 0),
  };
}

export interface SubscriptionLine { id: string; name: string; value: number; yearly: number; next: string; cancelBy: string; where: string; recurrence: "mensal" | "anual" }

/** Active subscriptions with the next charge and the last day to cancel so it does not come again. */
export function reviewSubscriptions(items: SubscriptionItem[], today: string): { lines: SubscriptionLine[]; monthly: number; yearly: number } {
  const lines = items.filter((s) => s.active).map((s) => ({
    id: s.id, name: s.name, value: r2(s.value), yearly: r2(s.recurrence === "anual" ? s.value : s.value * 12), next: s.next_charge,
    cancelBy: shift(s.next_charge, -1) < today ? today : shift(s.next_charge, -1), where: s.card_name ?? s.account_name, recurrence: s.recurrence,
  })).sort((a, b) => a.next.localeCompare(b.next));
  return { lines, monthly: r2(lines.reduce((s, l) => s + (l.recurrence === "anual" ? l.value / 12 : l.value), 0)), yearly: r2(lines.reduce((s, l) => s + l.yearly, 0)) };
}

/** What the plan set aside for each meta against what was really saved in Metas in the month. */
export function reviewGoals(month: string, goals: FinnosGoal[], saving: Record<string, number>) {
  return goals.map((g) => {
    const saved = r2((g.deposits ?? []).filter((d) => d.date.slice(0, 7) === month).reduce((s, d) => s + ((d.kind ?? "aporte") === "aporte" ? d.value : -d.value), 0));
    const planned = r2(saving[g.id] ?? 0);
    return { id: g.id, name: g.name, planned, saved, diff: r2(saved - planned), target: g.target, total: g.saved };
  }).filter((g) => g.planned > 0 || g.saved !== 0);
}

/** What diverged: categories over the limit (and what pushed them), bills that got more expensive, likely duplicates. */
export function divergences(month: string, txs: Transaction[], prevTxs: Transaction[], categories: CategoryLimit[]) {
  const spent = txs.filter((t) => t.date.slice(0, 7) === month && t.type === "despesa" && t.status === "pago" && !t.invoice_payment && !t.balance_adjustment);
  const over = categories.filter((c) => c.over > 0).sort((a, b) => b.over - a.over).map((c) => ({ ...c, top: spent.filter((t) => t.category_id === c.category_id).sort((a, b) => amount(b) - amount(a)).slice(0, 3) }));
  const bills = reviewBills(month, txs, prevTxs, "despesa");
  const priceUps = bills.changed.filter((l) => (l.delta ?? 0) > 0 && (l.tx.fixed || l.tx.recurrence_id));
  const dups: { a: Transaction; b: Transaction }[] = [];
  const sorted = [...spent].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i += 1) for (let j = i + 1; j < sorted.length; j += 1) {
    const a = sorted[i], b = sorted[j];
    if (days(a.date, b.date) > 3) break;
    if (normName(a.name) === normName(b.name) && Math.abs(amount(a) - amount(b)) < 0.01 && !a.installment) dups.push({ a, b });
  }
  return { over, priceUps, dups };
}

export interface Outlook { inTotal: number; billTotal: number; limitsTotal: number; saveTotal: number; leftover: number; endBalance: number; tone: "positivo" | "apertado" | "negativo" }

/** If the month follows the budget: what is left over and the balance at the end (starting from today's accounts). */
export function monthOutlook({ startBalance, inTotal, billTotal, limitsTotal, saveTotal }: { startBalance: number; inTotal: number; billTotal: number; limitsTotal: number; saveTotal: number }): Outlook {
  const leftover = r2(inTotal - billTotal - limitsTotal - saveTotal);
  return { inTotal, billTotal, limitsTotal, saveTotal, leftover, endBalance: r2(startBalance + inTotal - billTotal - limitsTotal), tone: leftover < 0 ? "negativo" : leftover < inTotal * 0.05 ? "apertado" : "positivo" };
}

/** Reminders worth setting for a new month (the person picks; none is created on its own). */
export function suggestReminders(rows: { key: string; name: string; date: string; value: number; type: "receita" | "despesa"; on: boolean; origin: string }[], cancel: SubscriptionLine[], existing: PlanReminder[]): PlanReminder[] {
  const have = new Set(existing.map((r) => r.id));
  const out: PlanReminder[] = [];
  for (const r of rows.filter((x) => x.on)) {
    if (r.type === "despesa" && r.value >= 150) out.push({ id: `pagar:${r.key}`, date: shift(r.date, -2), text: `Pagar ${r.name} (vence ${r.date.slice(8)}/${r.date.slice(5, 7)})`, kind: "conta" });
    if (r.type === "receita") out.push({ id: `conferir:${r.key}`, date: r.date, text: `Conferir se ${r.name} caiu`, kind: "recebimento" });
  }
  for (const s of cancel) out.push({ id: `cancelar:${s.id}`, date: s.cancelBy, text: `Cancelar ${s.name} antes da cobrança de ${s.next.slice(8)}/${s.next.slice(5, 7)}`, kind: "assinatura" });
  return out.filter((r) => !have.has(r.id));
}

/** Ideas to save in the new month, from the last months' limits (applied only if the person accepts). */
export function savingIdeas(history: { category_id: string; name: string; spent: number; limit: number }[][]) {
  if (!history.length) return [];
  const ids = new Set(history.flat().map((c) => c.category_id));
  const ideas: { category_id: string; name: string; kind: "baixar" | "subir"; from: number; to: number; text: string }[] = [];
  for (const id of ids) {
    const rows = history.map((h) => h.find((c) => c.category_id === id)).filter(Boolean) as { name: string; spent: number; limit: number }[];
    if (rows.length < 2 || !rows[0].limit) continue;
    const avg = rows.reduce((s, r) => s + r.spent, 0) / rows.length, limit = rows[0].limit, name = rows[0].name;
    if (rows.every((r) => r.limit > 0 && r.spent < r.limit * 0.75) && limit - avg >= 30) {
      const to = Math.ceil(avg / 10) * 10 + 20;
      ideas.push({ category_id: id, name, kind: "baixar", from: limit, to, text: `${name} usou em média ${Math.round(avg)} de ${Math.round(limit)} nos últimos ${rows.length} meses: baixar o limite libera ${Math.round(limit - to)} para guardar.` });
    } else if (rows.every((r) => r.limit > 0 && r.spent > r.limit)) {
      const to = Math.ceil(avg / 10) * 10;
      ideas.push({ category_id: id, name, kind: "subir", from: limit, to, text: `${name} passou do limite nos últimos ${rows.length} meses (média ${Math.round(avg)}): ou o limite sobe para ${to}, ou é aqui que dá para cortar.` });
    }
  }
  return ideas.sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to));
}

export const monthEnd = lastDay;
