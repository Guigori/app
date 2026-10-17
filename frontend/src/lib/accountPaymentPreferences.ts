import type { Account } from "@/types/finnos";
import { isLocalMode } from "@/lib/mode";
import { apiGet, apiPut } from "@/lib/api";

/** Preferences for a bank account, never credit card payment method data. */
export type PaymentMethod = "Pix" | "Débito" | "Dinheiro" | "Boleto";
export const PAYMENT_METHODS: PaymentMethod[] = ["Pix", "Débito", "Dinheiro", "Boleto"];
const storageKey = (id: string) => `finnos:payment-methods:local:${id}`;
const defaults = (account: Account): PaymentMethod[] => account.type === "carteira" ? ["Dinheiro"] : ["Pix", "Débito", "Boleto"];
const valid = (methods: unknown): PaymentMethod[] =>
  Array.isArray(methods) ? PAYMENT_METHODS.filter(m => methods.includes(m)) : [];

export async function getAccountPaymentMethods(account: Account): Promise<PaymentMethod[]> {
  if (!isLocalMode()) {
    const response = await apiGet<{ methods: PaymentMethod[] }>(`/accounts/${encodeURIComponent(account.id)}/payment-methods`);
    return valid(response.methods);
  }
  try {
    const saved = localStorage.getItem(storageKey(account.id));
    return saved !== null ? valid(JSON.parse(saved)) : defaults(account);
  } catch { return defaults(account); }
}

export async function setAccountPaymentMethods(account: Account, methods: PaymentMethod[]): Promise<void> {
  const normalized = valid(methods);
  if (!isLocalMode()) {
    await apiPut(`/accounts/${encodeURIComponent(account.id)}/payment-methods`, { methods: normalized });
  } else {
    localStorage.setItem(storageKey(account.id), JSON.stringify(normalized));
  }
  window.dispatchEvent(new CustomEvent("finnos:payment-methods-changed", { detail: account.id }));
}

export function clearLocalAccountPaymentMethods(accountId: string): void {
  if (isLocalMode()) localStorage.removeItem(storageKey(accountId));
}
