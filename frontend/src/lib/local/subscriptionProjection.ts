import type { SubscriptionItem, Transaction } from "@/types/finnos";
import { moneyCents } from "@/lib/roundMoney";

/** FIN-13: an active subscription is a plan, never a paid bank debit.
 * Preserve billing day (29–31 through February), and suppress a future
 * projection if the same plan already exists in transactions.
 */
function monthCharge(sub: SubscriptionItem, month: string): string | null {
  if (!sub.active) return null;
  const anchor = sub.next_charge;
  const [year, monthIndex] = month.split("-").map(Number);
  const [anchorYear, anchorMonth, anchorDay] = anchor.split("-").map(Number);
  const currentIndex = year * 12 + monthIndex - 1;
  const startIndex = anchorYear * 12 + anchorMonth - 1;
  if (currentIndex < startIndex) return null;
  if (sub.recurrence === "anual" && (currentIndex - startIndex) % 12 !== 0) return null;
  if (sub.recurrence !== "mensal" && sub.recurrence !== "anual") return null;
  const last = new Date(year, monthIndex, 0).getDate();
  return month + "-" + String(Math.min(last, anchorDay)).padStart(2, "0");
}

function matchingBill(sub: SubscriptionItem, tx: Transaction): boolean {
  if (tx.type !== "despesa" || tx.invoice_payment || tx.invoice_refund) return false;
  // Legacy FINNOS transaction type does not contain subscription_id; use
  // conservative billing identity and exact cents instead.
  return tx.name.trim().toLowerCase() === sub.name.trim().toLowerCase()
    && tx.account_id === sub.account_id
    && (tx.card_id || null) === (sub.card_id || null)
    && (tx.category_id || null) === (sub.category_id || null)
    && moneyCents(tx.value) === moneyCents(sub.value);
}

export function localSubscriptionProjections(
  subs: SubscriptionItem[], txs: Transaction[], month: string, today: string,
): Array<{ subscription: SubscriptionItem; date: string }> {
  return subs.flatMap(sub => {
    const date = monthCharge(sub, month);
    if (!date || date < today) return [];
    if (txs.some(tx => matchingBill(sub, tx) &&
      (tx.date.slice(0, 7) === month || tx.fixed))) return [];
    return [{ subscription: sub, date }];
  });
}
