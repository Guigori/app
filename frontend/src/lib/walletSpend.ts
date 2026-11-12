import type { Account, CreditCard, Transaction } from "@/types/finnos";

const METHOD = /Forma de pagamento:\s*([^\n]+)/i;

/** "Gasto do mês por forma de pagamento" of one account (etapa 6). Paid expenses of the month
 * straight from the account, by the method the register noted (Pix, Débito...); on a benefit
 * card, by benefit; plus the open invoice of the same bank's credit cards. Values in reais. */
export function monthSpendByMethod(account: Account, txs: Transaction[], bankCards: CreditCard[], month: string) {
  const totals = new Map<string, number>();
  const wallets = new Map((account.wallets ?? []).map((w) => [w.id, w.name]));
  const fallbackWallet = account.wallets?.find((w) => w.is_default)?.name;
  const add = (label: string, cents: number) => totals.set(label, (totals.get(label) ?? 0) + cents);
  for (const tx of txs) {
    if (tx.type !== "despesa" || tx.card_id || tx.account_id !== account.id || tx.status !== "pago" || !tx.date.startsWith(month)) continue;
    if (tx.invoice_payment || tx.balance_adjustment) continue;
    const cents = Math.round((tx.installment ? tx.installment_value ?? tx.value : tx.value) * 100);
    let label: string;
    if (account.type === "beneficio") label = wallets.get(tx.wallet_id ?? "") ?? fallbackWallet ?? "Benefício";
    else if (account.type === "carteira") label = "Dinheiro";
    else label = tx.notes?.match(METHOD)?.[1]?.trim() || "Pix ou débito";
    add(label, cents);
  }
  for (const card of bankCards) if (card.current_invoice > 0) add(`Crédito · ${card.name}`, Math.round(card.current_invoice * 100));
  const rows = [...totals.entries()].map(([label, cents]) => ({ label, value: cents / 100 })).sort((a, b) => b.value - a.value);
  return { rows, total: rows.reduce((s, r) => s + Math.round(r.value * 100), 0) / 100 };
}
