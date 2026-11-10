import type { Transaction } from "@/types/finnos";

/** Opens the register (the + sheet on the phone, the drawer on wide screens) from anywhere. */
export interface RegisterSheetRequest { existing?: Transaction; kind?: "Despesa" | "Receita" | "Transferência" }
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

/** Lançamentos the register screen edits; installments and invoice entries keep their own form. */
export const opensInRegister = (tx: Transaction) => !tx.fixed && !tx.recurrence_id && !tx.installment && !tx.invoice_payment && !tx.invoice_refund && !tx.id.startsWith("offline:");
