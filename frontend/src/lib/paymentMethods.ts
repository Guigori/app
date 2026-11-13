import { accountScope, defaultAccount, defaultCard } from "@/lib/walletDefaults";
import { formatBRL } from "@/lib/format";
import type { Account, CreditCard } from "@/types/finnos";

/** One choice for "how did you pay": "Nubank · Crédito", "Itaú · Pix/Débito",
 * "Vale-refeição", "Dinheiro". The defaults come first (etapa 2). */
export interface PaymentMethod {
  key: string; // "card:<id>" | "account:<id>"
  label: string;
  kind: "credito" | "conta" | "beneficio" | "dinheiro";
  accountId: string; // the server still needs an account on card purchases
  cardId: string | null;
}

export function paymentMethods(accounts: Account[], cards: CreditCard[]): PaymentMethod[] {
  const activeAccounts = accounts.filter((a) => a.active !== false);
  const activeCards = cards.filter((c) => c.active !== false);
  const bank = defaultAccount(activeAccounts, "account");
  const firstCard = defaultCard(activeCards);
  const orderedCards = firstCard ? [firstCard, ...activeCards.filter((c) => c.id !== firstCard.id)] : activeCards;
  const scoped = (scope: "account" | "benefit" | "cash") => {
    const inScope = activeAccounts.filter((a) => accountScope(a.type) === scope);
    const first = defaultAccount(inScope, scope);
    return first ? [first, ...inScope.filter((a) => a.id !== first.id)] : inScope;
  };
  const fallback = bank?.id ?? activeAccounts[0]?.id ?? "";
  return [
    ...orderedCards.map((c): PaymentMethod => ({
      key: `card:${c.id}`, label: `${c.name} · Crédito`, kind: "credito",
      // The old "conta de pagamento" is only a carrier for the record now.
      accountId: activeAccounts.some((a) => a.id === c.payment_account_id) ? c.payment_account_id! : fallback,
      cardId: c.id,
    })),
    ...scoped("account").map((a): PaymentMethod => ({ key: `account:${a.id}`, label: `${a.name} · Pix/Débito`, kind: "conta", accountId: a.id, cardId: null })),
    ...scoped("benefit").map((a): PaymentMethod => ({ key: `account:${a.id}`, label: a.name, kind: "beneficio", accountId: a.id, cardId: null })),
    ...scoped("cash").map((a): PaymentMethod => ({ key: `account:${a.id}`, label: a.name || "Dinheiro", kind: "dinheiro", accountId: a.id, cardId: null })),
  ];
}

export function methodKey(accountId: string, cardId: string | null | undefined): string {
  return cardId ? `card:${cardId}` : `account:${accountId}`;
}

const clampDay = (year: number, month: number, day: number) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
};

/** Closing date of the invoice that receives a purchase on `date` (same rule as finnos/lib/cards.py). */
export function invoiceClosingFor(date: string, closingDay: number): string {
  const [year, month] = date.split("-").map(Number);
  const thisClosing = clampDay(year, month, closingDay);
  if (date <= thisClosing) return thisClosing;
  const next = year * 12 + month; // zero-based month index of the following month
  return clampDay(Math.floor(next / 12), (next % 12) + 1, closingDay);
}

/** "Vai para a fatura que fecha em 03/12" or "Sai do saldo: fica R$ 2.111,45". */
export function paymentEffect(method: PaymentMethod | undefined, amount: number, date: string,
                              accounts: Account[], cards: CreditCard[], editing?: { accountId: string; cardId: string | null; value: number } | null): string | null {
  if (!method || !date) return null;
  if (method.cardId) {
    const card = cards.find((c) => c.id === method.cardId);
    if (!card) return null;
    const closing = invoiceClosingFor(date, card.closing_day);
    return `Vai para a fatura que fecha em ${closing.slice(8, 10)}/${closing.slice(5, 7)}.`;
  }
  const account = accounts.find((a) => a.id === method.accountId);
  if (!account) return null;
  // When editing, the old value already left this account.
  const already = editing && !editing.cardId && editing.accountId === account.id ? editing.value : 0;
  return `Sai do saldo: fica ${formatBRL(account.balance + already - (amount || 0))}.`;
}
