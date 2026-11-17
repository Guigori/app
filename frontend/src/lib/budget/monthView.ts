/**
 * Orçamento · tela 1 (início do mês): everything the screen shows, computed on the device from data that already
 * lives in its own module (Carteira, Fluxo, Assinaturas, Metas). Nothing here writes: the Orçamento only keeps limits.
 *
 * Rules approved in the prototype:
 * - The "livre para gastar" counts only money that already landed: account balances (no benefits, no overdraft)
 *   minus what is still to be paid until the end of the month (scheduled + estimated) and the cushion.
 *   An income that is only expected never enters the livre.
 * - Three states: Realizado (paid), Agendado (has a date: scheduled, installment, subscription, fixed bill),
 *   Estimativa (may or may not happen: pending, or a monthly bill repeated from last month).
 * - Card purchases count once, through the invoice (its payable amount, on its due date).
 * - Category limits count spending by payment origin: what a benefit (VR/VA) paid counts in the limit and is shown apart.
 */
import type { Account, BudgetSummary, CalendarMonth, CreditCard, Flow, Transaction, UpcomingItem, BalanceHistory } from "@/types/finnos";
import type { FinnosGoal } from "@/lib/goals";
import { goalProgress } from "@/lib/goalProgress";

export type PlanState = "realizado" | "agendado" | "estimativa";

export interface PlanItem {
  key: string;
  name: string;
  date: string;
  value: number;
  type: "receita" | "despesa";
  state: PlanState;
  /** Where it lives, to open it there. */
  source: "fluxo" | "assinatura" | "cartao";
  transaction_id?: string | null;
  subscription_id?: string | null;
  card_id?: string | null;
  category_name?: string | null;
  /** Repeated or projected by the app: enters the plan only after the person approves it. */
  suggested?: boolean;
}

export interface CategoryLimit {
  category_id: string;
  name: string;
  color: string;
  group: string;
  spent: number;
  limit: number;
  /** Part of `spent` paid with a benefit card (VR/VA). */
  benefit: number;
  /** Part of `limit` that comes from a special plan running in the month (its money is in a meta). */
  special: number;
  over: number;
}

export interface MonthAlert { id: string; tone: "expense" | "info" | "forecast"; text: string }

export interface MatchSuggestion { realized: Transaction; estimate: PlanItem; difference: number }

export interface MonthView {
  month: string;
  today: string;
  /** "current" | "past" | "future" relative to today. */
  when: "past" | "current" | "future";
  daysInMonth: number;
  /** Days left counting today (current month only). */
  daysLeft: number;
  inAccounts: number;
  toPay: number;
  cushion: number;
  /** Planned contributions to metas this month (from the plan). */
  goalsReserve: number;
  free: number;
  /** The livre if every expected income comes in (never the main number). */
  projectedFree: number;
  /** Balances that make up "nas contas" (no benefits). */
  balances: { id: string; name: string; balance: number }[];
  /** Money that never enters the livre: benefits and overdraft limits. */
  outside: { id: string; name: string; value: number; kind: "beneficio" | "cheque" }[];
  perDay: number;
  /** Still expected to come in (estimate or scheduled): never in the livre. */
  toReceive: number;
  earned: number;
  leftAccounts: number;
  spent: number;
  items: PlanItem[];
  /** Repeated from an earlier month or projected by Assinaturas: shown to review, counted only once approved. */
  suggestions: PlanItem[];
  projection: { date: string; value: number; kind: "real" | "previsto" }[];
  endBalance: number;
  lowest: { date: string; value: number } | null;
  heat: Record<string, number>;
  slices: { id: string; name: string; value: number; color: string }[];
  daily: { spent: number; limit: number; percent: number; elapsed: number; allowance: number };
  categories: CategoryLimit[];
  alerts: MonthAlert[];
  match: MatchSuggestion | null;
  goals: { id: string; name: string; saved: number; target: number; percent: number }[];
}

export interface MonthViewInput {
  month: string;
  today: string;
  accounts: Account[];
  cards: CreditCard[];
  flow: Flow;
  calendar: CalendarMonth | null;
  balance: BalanceHistory | null;
  budget: BudgetSummary | null;
  /** Limits of the active budget cycle, when one covers the month: they win over the category default. */
  cycleLimits?: Record<string, number> | null;
  transactions: Transaction[];
  goals: FinnosGoal[];
  cushion?: number;
  dismissedMatches?: string[];
  /** Keys of suggested items the person approved for this month (nothing enters the plan on its own). */
  approved?: string[];
  /** Keys of suggested items the person chose to leave out. */
  ignored?: string[];
  /** What the month's plan sets aside for metas: it is not free to spend. */
  goalsReserve?: number;
  /** Extra limit per category from special plans that overlap the month. */
  specialLimits?: Record<string, number>;
  /** Which alerts the person wants (Configurar). Missing = on. */
  alertsOn?: Partial<Record<"categoria" | "limite80" | "estimativa" | "fatura" | "recebimento" | "parecido", boolean>>;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const daysOf = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const dayISO = (month: string, d: number) => `${month}-${String(d).padStart(2, "0")}`;

/** Made by the app (a bill repeated from an earlier month, a subscription's next charge), not registered by the person. */
export function isSuggestion(item: Pick<UpcomingItem, "kind" | "transaction_id">): boolean {
  return (item.kind === "fixa" && !item.transaction_id) || item.kind === "assinatura";
}

/** The same item keeps the same key in every screen (approvals in the plan are kept by it). */
export function upcomingKey(u: Pick<UpcomingItem, "transaction_id" | "subscription_id" | "name" | "date">): string {
  return u.transaction_id ? `tx:${u.transaction_id}` : u.subscription_id ? `sub:${u.subscription_id}:${u.date}` : `fx:${u.name}:${u.date}`;
}

export function stateOf(item: Pick<UpcomingItem, "kind" | "transaction_id">): PlanState {
  if (item.kind === "pendente") return "estimativa";
  // A monthly bill repeated from an earlier month, with no record of its own yet.
  if (item.kind === "fixa" && !item.transaction_id) return "estimativa";
  return "agendado";
}

/** A record that is part of the plan once it happened: an income, or a fixed / recurring / installment bill. */
function plannedRealized(tx: Transaction): boolean {
  if (tx.status !== "pago" || tx.type === "transferencia" || tx.invoice_payment || tx.balance_adjustment || tx.benefit_recharge) return false;
  return tx.type === "receita" || tx.fixed || !!tx.recurrence_id || tx.installment;
}

function similar(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  const wa = new Set(norm(a));
  return norm(b).some((w) => wa.has(w));
}

export function buildMonthView(input: MonthViewInput): MonthView {
  const { month, today, flow } = input;
  const thisMonth = today.slice(0, 7);
  const when = month < thisMonth ? "past" : month > thisMonth ? "future" : "current";
  const daysInMonth = daysOf(month);
  const daysLeft = when === "current" ? daysInMonth - Number(today.slice(8)) + 1 : when === "future" ? daysInMonth : 0;
  const benefitIds = new Set(input.accounts.filter((a) => a.type === "beneficio").map((a) => a.id));

  // --- what is still expected this month (Fluxo + Assinaturas) and the card invoices due in it (Carteira)
  const approved = new Set(input.approved ?? []), ignored = new Set(input.ignored ?? []);
  const upcoming: PlanItem[] = (flow.upcoming ?? [])
    .filter((u) => when !== "current" || u.date >= today || stateOf(u) === "estimativa")
    .map((u) => ({
      key: upcomingKey(u),
      name: u.name, date: u.date, value: u.value, type: u.type, state: stateOf(u),
      source: u.subscription_id ? "assinatura" : "fluxo",
      transaction_id: u.transaction_id ?? null, subscription_id: u.subscription_id ?? null, category_name: u.category_name ?? null,
      suggested: isSuggestion(u),
    }));
  const expected = upcoming.filter((u) => !u.suggested || approved.has(u.key));
  const suggestions = upcoming.filter((u) => u.suggested && !approved.has(u.key) && !ignored.has(u.key));
  const invoices: PlanItem[] = input.cards
    .filter((c) => c.active && (c.payable_invoice ?? 0) > 0 && c.payable_due && c.payable_due.slice(0, 7) === month && (when !== "current" || c.payable_due >= today || !c.invoice_paid))
    .map((c) => ({ key: `card:${c.id}:${c.payable_cycle ?? ""}`, name: `Fatura ${c.name}`, date: c.payable_due!, value: r2(c.payable_invoice ?? 0), type: "despesa", state: "agendado", source: "cartao", card_id: c.id }));
  const realized: PlanItem[] = input.transactions
    .filter((t) => t.date.slice(0, 7) === month && plannedRealized(t) && !benefitIds.has(t.account_id) && !t.card_id)
    .map((t) => ({ key: `tx:${t.id}`, name: t.name, date: t.date, value: r2(t.installment ? (t.installment_value ?? t.value) : t.value), type: t.type === "receita" ? "receita" : "despesa", state: "realizado", source: "fluxo", transaction_id: t.id, category_name: t.category_name }));
  const items = [...realized, ...expected, ...invoices].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  const open = items.filter((i) => i.state !== "realizado");
  const toPay = r2(open.filter((i) => i.type === "despesa").reduce((s, i) => s + i.value, 0));
  const toReceive = r2(open.filter((i) => i.type === "receita").reduce((s, i) => s + i.value, 0));

  // --- the livre: only what already landed (no benefit, no overdraft)
  const inAccounts = r2(input.accounts.filter((a) => a.active && a.type !== "beneficio").reduce((s, a) => s + a.balance, 0));
  const cushion = Math.max(0, input.cushion ?? 0);
  const goalsReserve = when === "past" ? 0 : Math.max(0, input.goalsReserve ?? 0);
  const free = when === "past" ? 0 : r2(inAccounts - toPay - cushion - goalsReserve);
  const projectedFree = when === "past" ? 0 : r2(free + toReceive);
  const balances = input.accounts.filter((a) => a.active && a.type !== "beneficio").map((a) => ({ id: a.id, name: a.name, balance: r2(a.balance) }));
  const outside: MonthView["outside"] = [
    ...input.accounts.filter((a) => a.active && a.type === "beneficio").map((a) => ({ id: a.id, name: a.name, value: r2(a.balance), kind: "beneficio" as const })),
    ...input.accounts.filter((a) => a.active && (a.overdraft_limit ?? 0) > 0).map((a) => ({ id: `${a.id}:cheque`, name: `Cheque especial ${a.name}`, value: r2(a.overdraft_limit ?? 0), kind: "cheque" as const })),
  ];
  const perDay = daysLeft > 0 ? Math.max(0, Math.floor((free / daysLeft) * 100) / 100) : 0;

  // --- earned / left the accounts / spent (competência)
  const monthTx = input.transactions.filter((t) => t.date.slice(0, 7) === month && t.status === "pago" && t.date <= today);
  const earned = r2(flow.income);
  const leftAccounts = r2(monthTx.filter((t) => t.type === "despesa" && !t.card_id && !benefitIds.has(t.account_id) && !t.balance_adjustment)
    .reduce((s, t) => s + (t.installment ? (t.installment_value ?? t.value) : t.value), 0));
  const spent = r2(flow.expense);

  // --- balance line: real days, then the estimate day by day with what is expected
  const projection: MonthView["projection"] = [];
  const realDays = input.balance?.days ?? [];
  for (const d of realDays) projection.push({ date: d.date, value: d.balance, kind: "real" });
  let running = realDays.at(-1)?.balance ?? inAccounts;
  let lowest: MonthView["lowest"] = null;
  if (when !== "past") {
    const startDay = when === "current" ? Number(today.slice(8)) + 1 : 1;
    if (when === "future") projection.push({ date: dayISO(month, 1), value: running, kind: "real" });
    for (let d = startDay; d <= daysInMonth; d += 1) {
      const date = dayISO(month, d);
      for (const it of open) if (it.date === date || (d === startDay && it.date < date)) running += it.type === "receita" ? it.value : -it.value;
      running = r2(running);
      projection.push({ date, value: running, kind: "previsto" });
      if (!lowest || running < lowest.value) lowest = { date, value: running };
    }
  }
  const endBalance = projection.at(-1)?.value ?? inAccounts;

  // --- spending by day (heat) and composition (donut)
  const heat: Record<string, number> = {};
  for (const d of input.calendar?.days ?? []) if (d.expense > 0) heat[d.date] = r2(d.expense);
  const slices = flow.categories.slice(0, 5).map((c) => ({ id: c.category_id ?? "sem", name: c.name, value: c.total, color: c.color }));
  const rest = flow.categories.slice(5).reduce((s, c) => s + c.total, 0);
  if (rest > 0) slices.push({ id: "outros", name: "Outros", value: r2(rest), color: "#94A3B8" });

  // --- limits by category: the cycle's limit wins over the category default; benefit spending shown apart
  const benefitByCat = new Map<string, number>();
  for (const t of monthTx) if (t.type === "despesa" && benefitIds.has(t.account_id) && t.category_id) benefitByCat.set(t.category_id, (benefitByCat.get(t.category_id) ?? 0) + t.value);
  const categories: CategoryLimit[] = (input.budget?.rows ?? [])
    .map((row) => {
      const special = input.specialLimits?.[row.category_id] ?? 0;
      const limit = (input.cycleLimits?.[row.category_id] ?? row.budget) + special;
      return { category_id: row.category_id, name: row.name, color: row.color, group: row.group, spent: r2(row.spent), limit: r2(limit), benefit: r2(Math.min(row.spent, benefitByCat.get(row.category_id) ?? 0)), special: r2(special), over: r2(Math.max(0, row.spent - limit)) };
    })
    // Guardar is Metas' job: the metas group (Investimentos, Metas) is not a spending limit of the month.
    .filter((c) => c.limit > 0 && c.group !== "metas")
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit);
  const dailyLimit = r2(categories.reduce((s, c) => s + c.limit, 0));
  const dailySpent = r2(categories.reduce((s, c) => s + c.spent, 0));
  const elapsed = when === "past" ? 1 : when === "future" ? 0 : Number(today.slice(8)) / daysInMonth;
  const dailyLeftDays = when === "current" ? daysInMonth - Number(today.slice(8)) : when === "future" ? daysInMonth : 0;
  const daily = { spent: dailySpent, limit: dailyLimit, percent: dailyLimit ? dailySpent / dailyLimit : 0, elapsed,
    allowance: dailyLeftDays > 0 ? Math.max(0, Math.floor(((dailyLimit - dailySpent) / dailyLeftDays) * 100) / 100) : 0 };

  // --- alerts about the plan
  const on = (k: keyof NonNullable<MonthViewInput["alertsOn"]>) => input.alertsOn?.[k] !== false;
  const alerts: MonthAlert[] = [];
  for (const c of categories) {
    if (c.over > 0 && on("categoria")) alerts.push({ id: `over:${c.category_id}`, tone: "expense", text: `${c.name} passou ${brl(c.over)} do limite.` });
    else if (c.over <= 0 && c.limit > 0 && c.spent / c.limit >= 0.8 && when === "current" && on("limite80")) alerts.push({ id: `80:${c.category_id}`, tone: "info", text: `${c.name} já usou ${Math.round((c.spent / c.limit) * 100)}% do limite.` });
  }
  if (when === "current") {
    for (const it of open) if (on("estimativa") && it.state === "estimativa" && it.date < today) alerts.push({ id: `late:${it.key}`, tone: "forecast", text: `${it.name} (${brl(it.value)}) estava previsto para ${it.date.slice(8)}/${it.date.slice(5, 7)} e ainda não aconteceu.` });
    for (const c of input.cards) {
      if (!c.active || !c.next_closing) continue;
      const days = Math.round((Date.parse(`${c.next_closing}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86400000);
      if (days >= 0 && days <= 3 && on("fatura")) alerts.push({ id: `close:${c.id}`, tone: "info", text: `A fatura ${c.name} fecha em ${c.next_closing.slice(8)}/${c.next_closing.slice(5, 7)}: compras depois disso vão para a próxima.` });
    }
    const estIncome = open.filter((i) => i.type === "receita" && i.state === "estimativa");
    if (estIncome.length && on("recebimento")) {
      const sum = estIncome.reduce((s, i) => s + i.value, 0);
      alerts.push({ id: "income-est", tone: "forecast", text: `${estIncome.length === 1 ? estIncome[0].name : `${estIncome.length} recebimentos`} (${brl(sum)}) ${estIncome.length === 1 ? "é estimativa" : "são estimativas"}. Se não cair, o fim do mês fica em ${brl(endBalance - sum)}.` });
    }
  }

  // --- "Para confirmar": a realized record that looks like an open estimate (the person decides)
  let match: MatchSuggestion | null = null;
  if (when === "current" && on("parecido")) {
    const recent = monthTx.filter((t) => t.date >= addDays(today, -7) && !t.invoice_payment && !t.balance_adjustment && t.type !== "transferencia" && !t.fixed);
    for (const est of open.filter((i) => i.state === "estimativa" && i.date <= addDays(today, 7))) {
      const hit = recent.find((t) => (t.type === "receita") === (est.type === "receita") && Math.abs(t.value - est.value) <= Math.max(5, est.value * 0.15) && similar(t.name, est.name)
        && !(input.dismissedMatches ?? []).includes(`${t.id}|${est.key}`));
      if (hit) { match = { realized: hit, estimate: est, difference: r2(hit.value - est.value) }; break; }
    }
  }

  const accountBalance = (id: string) => input.accounts.find((a) => a.id === id)?.balance ?? null;
  const goals = input.goals.map((g) => {
    const p = goalProgress(g, g.track_account ? accountBalance(g.account) : null, today);
    return { id: g.id, name: g.name, saved: p.saved, target: g.target, percent: g.target > 0 ? Math.min(1, p.saved / g.target) : 0 };
  });

  return { month, today, when, daysInMonth, daysLeft, inAccounts, toPay, cushion, goalsReserve, projectedFree, balances, outside, free, perDay, toReceive, earned, leftAccounts, spent, items, suggestions,
    projection, endBalance, lowest, heat, slices, daily, categories, alerts, match, goals };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
