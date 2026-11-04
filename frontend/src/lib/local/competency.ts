import type { LocalDb } from "./store";

/** FIN-08 shared compensation events for every local financial view.
 * A merchant credit reduces the original spending category; a bank refund
 * credits cash elsewhere but is never duplicated as ordinary income.
 */
export interface LocalCreditEvent {
  date: string;
  category_id: string | null;
  amount: number;
  id: string;
  kind: "merchant_credit" | "bank_refund";
}

export function localCreditEvents(db: Pick<LocalDb, "cards" | "transactions">): LocalCreditEvent[] {
  const purchases = new Map(db.transactions.map(tx => [tx.id, tx]));
  const result: LocalCreditEvent[] = [];
  const seen = new Set<string>();
  for (const card of db.cards) {
    for (const [kind, ledger] of [
      ["merchant_credit", card.invoice_adjustments],
      ["bank_refund", card.invoice_refunds],
    ] as const) {
      for (const events of Object.values(ledger ?? {})) {
        for (const event of events) {
          const origin = purchases.get(event.purchase_id);
          const id = `${card.id}:${kind}:${event.id}`;
          if (!origin || seen.has(id)) continue;
          seen.add(id);
          result.push({
            date: event.date,
            category_id: origin.category_id,
            amount: event.value,
            id: event.id,
            kind,
          });
        }
      }
    }
  }
  return result;
}

export function creditsForMonth(events: LocalCreditEvent[], month: string): LocalCreditEvent[] {
  return events.filter(item => item.date.slice(0, 7) === month);
}
