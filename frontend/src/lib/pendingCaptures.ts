/** Choices on a pending Apple Pay purchase, kept apart from the screen so they can be tested. */
import type { Account, CreditCard, PaymentMethod, PendingCapture, PendingCaptureConfirm } from "@/types/finnos";

/** What the person has on screen for one purchase. */
export interface CaptureChoice {
  method: PaymentMethod;
  accountId: string;
  cardId: string;
  categoryId: string;
  installments: number;
}

/** Débito by default, with everything FINNOS learned already filled in. */
export function initialChoice(item: PendingCapture): CaptureChoice {
  return {
    method: "debito",
    accountId: item.suggested_account_id ?? "",
    cardId: item.suggested_card_id ?? "",
    categoryId: item.suggested_category_id ?? "",
    installments: 1,
  };
}

export const activeAccounts = (accounts: Account[]) => accounts.filter((a) => a.active);
export const activeCards = (cards: CreditCard[]) => cards.filter((c) => c.active);

/** Débito needs the account it came out of; crédito needs the card. */
export function canRegister(choice: CaptureChoice): boolean {
  return choice.method === "credito" ? choice.cardId !== "" : choice.accountId !== "";
}

/** The body for "Registrar": the method and its wallet are always sent explicitly. */
export function confirmBody(choice: CaptureChoice): PendingCaptureConfirm {
  if (!canRegister(choice)) {
    throw new Error(choice.method === "credito" ? "Escolha o cartão de crédito." : "Escolha a conta de onde saiu o dinheiro.");
  }
  const body: PendingCaptureConfirm = { method: choice.method };
  if (choice.method === "credito") {
    body.card_id = choice.cardId;
    if (choice.installments > 1) body.installments = choice.installments;
  } else {
    body.account_id = choice.accountId;
  }
  if (choice.categoryId) body.category_id = choice.categoryId;
  return body;
}

/** "Registrar N no débito": purchases that already have an account to come out of. A name that is
 * both an account and a card is left out: débito or crédito is picked by hand. */
export function readyToRegister(items: PendingCapture[]): number {
  return items.filter((i) => !i.is_test && i.suggested_account_id && !i.ambiguous).length;
}

/** Both answers are ready (account and card with Apple Pay's name): one tap each, neither assumed. */
export function asksDebitOrCredit(item: PendingCapture): boolean {
  return Boolean(item.ambiguous && item.suggested_account_id && item.suggested_card_id);
}

/** Filter for Fluxo: what came from Apple Pay. */
export type CaptureFilter = "todas" | "apple_pay" | "apple_pay_auto";

export function matchesCaptureFilter(t: { capture?: string | null }, filter: CaptureFilter): boolean {
  if (filter === "todas") return true;
  if (filter === "apple_pay_auto") return t.capture === "apple_pay_auto";
  return t.capture === "apple_pay" || t.capture === "apple_pay_auto";
}

/** The small mark next to a lançamento in Fluxo. */
export function captureBadge(t: { capture?: string | null; capture_unusual?: boolean }): string | null {
  if (t.capture === "apple_pay_auto") return t.capture_unusual ? "Apple Pay · automático · valor alto" : "Apple Pay · automático";
  if (t.capture === "apple_pay") return "Apple Pay";
  return null;
}

/** Purchases with nothing to suggest yet: the card is not registered and was never chosen. */
export function needsWallet(items: PendingCapture[]): number {
  return items.filter((i) => !i.is_test && !i.suggested_account_id && !i.suggested_card_id).length;
}

function clampDay(year: number, month0: number, day: number): Date {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month0, Math.min(day, last)));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface InvoiceTarget {
  /** Day the invoice closes ("YYYY-MM-DD"). */
  closing: string;
  /** Day it is paid. */
  due: string;
  /** Bought after this month's closing: it goes to the next invoice. */
  afterClosing: boolean;
}

/**
 * Which invoice a crédito purchase lands on: the first closing on or after the purchase day.
 * Mirrors finnos/lib/cards.py (cycle_bounds, due_date) so the screen says what the server does.
 */
export function invoiceFor(purchaseDate: string, card: Pick<CreditCard, "closing_day" | "due_day">): InvoiceTarget {
  const [y, m, d] = purchaseDate.split("-").map(Number);
  const purchase = new Date(Date.UTC(y, m - 1, d));
  const thisClosing = clampDay(y, m - 1, card.closing_day);
  const closing = purchase <= thisClosing ? thisClosing : clampDay(y, m, card.closing_day);
  const due = card.due_day > card.closing_day
    ? clampDay(closing.getUTCFullYear(), closing.getUTCMonth(), card.due_day)
    : clampDay(closing.getUTCFullYear(), closing.getUTCMonth() + 1, card.due_day);
  return { closing: iso(closing), due: iso(due), afterClosing: purchase > thisClosing };
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dm = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;

/** "Fatura de dezembro · fecha 05/12 · vence 12/12", named by the month it is paid. */
export function invoiceLabel(target: InvoiceTarget): string {
  return `Fatura de ${MONTHS[Number(target.due.slice(5, 7)) - 1]} · fecha ${dm(target.closing)} · vence ${dm(target.due)}`;
}

/** "pendente há 4 dias", or nothing for a purchase that just arrived. */
export function waitingLabel(item: PendingCapture): string {
  return item.stale ? `pendente há ${item.waiting_days} dias` : "";
}

/** The message to show when the server refuses (its 422 text says exactly what is missing). */
export function refusalMessage(error: unknown, fallback: string): string {
  const detail = (error as { body?: { detail?: unknown } } | null)?.body?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

/** How many purchases Início shows; the rest are one tap away in Fluxo. */
export const HOME_LIMIT = 3;

/** Oldest waiting first (they were forgotten), then the newest purchases. */
export function orderForReview(items: PendingCapture[]): PendingCapture[] {
  return [...items].sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? -1 : 1;
    if (a.stale) return b.waiting_days - a.waiting_days;
    return (b.date + (b.created_at ?? "")).localeCompare(a.date + (a.created_at ?? ""));
  });
}

export interface ChoiceSummary {
  /** "Débito · Itaú · Mercado", or what is still missing. */
  text: string;
  /** Something must be chosen before registering. */
  missing: boolean;
}

/** One line under the purchase: what will be registered if the person taps Registrar now. */
export function choiceSummary(
  choice: CaptureChoice,
  accounts: Pick<Account, "id" | "name">[],
  cards: Pick<CreditCard, "id" | "name">[],
  categories: { id: string; name: string }[],
): ChoiceSummary {
  const credit = choice.method === "credito";
  const wallet = credit ? cards.find((c) => c.id === choice.cardId)?.name : accounts.find((a) => a.id === choice.accountId)?.name;
  if (!wallet) return { text: credit ? "Crédito · falta escolher o cartão" : "Débito · falta escolher a conta", missing: true };
  const parts = [credit ? "Crédito" : "Débito", wallet];
  if (credit && choice.installments > 1) parts.push(`${choice.installments}x`);
  parts.push(categories.find((c) => c.id === choice.categoryId)?.name ?? "sem categoria");
  return { text: parts.join(" · "), missing: false };
}
