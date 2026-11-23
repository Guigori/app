import type { Transaction } from "@/types/finnos";

/** Opens the register (the + sheet on the phone, the drawer on wide screens) from anywhere. */
export interface RegisterSheetRequest { existing?: Transaction; template?: Transaction; siblings?: Transaction[]; kind?: "Despesa" | "Receita" | "Transferência";
  /** "Pagar fatura": the same register, as the payment of this card's invoice (cycle = its closing date). */
  invoice?: { cardId: string; cycle?: string };
  /** The date a new entry starts with (e.g. a bill that was missing from a month being closed). */
  date?: string;
  /** A new entry saved as an estimate ("pendente"): it does not count until it happens (forecasts of a month to come). */
  estimate?: boolean }
const EVENT = "finnos:open-register";
export const DASHBOARD_QUERY = "(min-width: 768px), (orientation: landscape)";

export function openRegisterSheet(request: RegisterSheetRequest = {}) {
  window.dispatchEvent(new CustomEvent<RegisterSheetRequest>(EVENT, { detail: request }));
}

export function onRegisterSheet(handler: (request: RegisterSheetRequest) => void, wide: boolean) {
  const listener = (e: Event) => { if (window.matchMedia(DASHBOARD_QUERY).matches === wide) handler((e as CustomEvent<RegisterSheetRequest>).detail ?? {}); };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** Every saved lançamento opens in the register screen; only an unsynced offline one keeps the review form. */
export const opensInRegister = (tx: Transaction) => !tx.id.startsWith("offline:");

/** A not-yet-saved lançamento to open the register with (template): only the fields given are filled. */
export function draftTransaction(p: Partial<Transaction> & Pick<Transaction, "type">): Transaction {
  return {
    id: "", version: 1, recurrence_id: null, name: "", value: 0, status: "pago", date: new Date().toISOString().slice(0, 10),
    account_id: "", account_name: "", card_id: null, card_name: null, to_account_id: null, to_account_name: null,
    category_id: null, category_name: null, category_color: null, category_icon: null, fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null,
    notify_enabled: false, created_at: new Date().toISOString(), ...p,
  } as unknown as Transaction;
}
