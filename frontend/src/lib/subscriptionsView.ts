/** Pure helpers behind the Assinaturas tab: monthly cost, upcoming charges and per-card totals. */
import type { SubscriptionInput, SubscriptionItem, Transaction } from "@/types/finnos";

const DAY = 86_400_000;

export function monthlyCost(item: Pick<SubscriptionItem, "value" | "recurrence">): number {
  return item.recurrence === "anual" ? item.value / 12 : item.value;
}

export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(iso + "T12:00:00") - Date.parse(today + "T12:00:00")) / DAY);
}

/** Active subscriptions charged within `days` (overdue ones included), soonest first. */
export function upcomingCharges(items: SubscriptionItem[], today: string, days = 30) {
  return items
    .filter((item) => item.active && daysUntil(item.next_charge, today) <= days)
    .map((item) => ({ item, days: daysUntil(item.next_charge, today) }))
    .sort((a, b) => a.days - b.days || a.item.name.localeCompare(b.item.name, "pt-BR"));
}

/** Monthly cost of the active subscriptions charged on each card. */
export function subscriptionsByCard(items: SubscriptionItem[]): Map<string, { count: number; monthly: number }> {
  const byCard = new Map<string, { count: number; monthly: number }>();
  for (const item of items) {
    if (!item.active || !item.card_id) continue;
    const current = byCard.get(item.card_id) ?? { count: 0, monthly: 0 };
    byCard.set(item.card_id, { count: current.count + 1, monthly: current.monthly + monthlyCost(item) });
  }
  return byCard;
}

export function whenLabel(days: number): string {
  if (days < 0) return `atrasada ${-days} ${days === -1 ? "dia" : "dias"}`;
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  return `em ${days} dias`;
}

/** Same day next month, clamped to the month's last day (31/01 → 28/02). */
export function nextMonthlyDate(lastISO: string, today: string): string {
  const [y, m, d] = lastISO.split("-").map(Number);
  let year = y, month = m;
  for (let i = 0; i < 24; i++) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    const last = new Date(year, month, 0).getDate();
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
    if (iso >= today) return iso;
  }
  return today;
}

/** A recurring expense found by the Radar, turned into a subscription draft. */
export function seedFromTransaction(tx: Transaction, today: string): Partial<SubscriptionInput> {
  return {
    name: tx.name,
    value: tx.installment_value ?? tx.value,
    recurrence: "mensal",
    // A charge already scheduled in Fluxo is the next one; a past one repeats next month.
    next_charge: tx.date >= today ? tx.date : nextMonthlyDate(tx.date, today),
    account_id: tx.account_id ?? "",
    card_id: tx.card_id ?? null,
    category_id: tx.category_id ?? null,
    active: true,
  };
}

export function toInput(item: SubscriptionItem, patch: Partial<SubscriptionInput> = {}): SubscriptionInput {
  return {
    name: item.name,
    value: item.value,
    recurrence: item.recurrence,
    next_charge: item.next_charge,
    account_id: item.account_id,
    category_id: item.category_id,
    card_id: item.card_id,
    active: item.active,
    notes: item.notes ?? null,
    ...patch,
  };
}

const normName = (text: string) => text.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/** A subscription as it appears in Fluxo: expenses in the "Assinaturas" category, grouped by name. */
export interface FluxoSubscription {
  key: string;
  name: string;
  value: number;
  lastDate: string;
  nextCharge: string;
  count: number;
  accountId: string;
  cardId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  last: Transaction;
}

export function isSubscriptionCategory(name: string | null | undefined): boolean {
  return Boolean(name && normName(name).includes("assinatura"));
}

/**
 * Groups the subscription expenses registered in Fluxo and splits them into the ones already
 * followed here (matched by name to a registered subscription) and the ones only in Fluxo.
 */
export function fluxoSubscriptions(txs: Transaction[], items: SubscriptionItem[], today: string) {
  const groups = new Map<string, Transaction[]>();
  for (const tx of txs) {
    if (tx.type !== "despesa" || !isSubscriptionCategory(tx.category_name)) continue;
    const key = normName(tx.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), tx]);
  }
  const registered = new Map(items.map((item) => [normName(item.name), item]));
  const matched = new Map<string, FluxoSubscription>();
  const onlyInFluxo: FluxoSubscription[] = [];
  for (const [key, rows] of groups) {
    const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
    const last = sorted[0];
    const entry: FluxoSubscription = {
      key,
      name: last.name,
      value: last.installment_value ?? last.value,
      lastDate: last.date,
      nextCharge: last.date >= today ? last.date : nextMonthlyDate(last.date, today),
      count: rows.length,
      accountId: last.account_id,
      cardId: last.card_id,
      categoryId: last.category_id,
      categoryName: last.category_name,
      categoryColor: last.category_color,
      last,
    };
    const item = registered.get(key);
    if (item) matched.set(item.id, entry);
    else onlyInFluxo.push(entry);
  }
  onlyInFluxo.sort((a, b) => a.nextCharge.localeCompare(b.nextCharge));
  return { matched, onlyInFluxo };
}
