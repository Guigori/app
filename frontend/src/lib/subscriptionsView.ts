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
    next_charge: nextMonthlyDate(tx.date, today),
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
