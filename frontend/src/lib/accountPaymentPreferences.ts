import type { Account } from "@/types/finnos";
import { isLocalMode } from "@/lib/mode";
import { firebaseAuth } from "@/lib/firebase";

export type PaymentMethod = "Pix" | "Débito" | "Dinheiro" | "Boleto";
export const PAYMENT_METHODS: PaymentMethod[] = ["Pix", "Débito", "Dinheiro", "Boleto"];
const storageKey = (id: string) => `finnos:payment-methods:${isLocalMode() ? "local" : firebaseAuth.currentUser?.uid || "anonymous"}:${id}`;
export function getAccountPaymentMethods(account: Account): PaymentMethod[] {
  try {
    const saved = localStorage.getItem(storageKey(account.id));
    if (saved !== null) {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) return PAYMENT_METHODS.filter(m => parsed.includes(m));
    }
  } catch { /* corrupted preference falls back to defaults */ }
  return account.type === "carteira" ? ["Dinheiro"] : ["Pix", "Débito", "Boleto"];
}
export function setAccountPaymentMethods(account: Account, methods: PaymentMethod[]) {
  localStorage.setItem(storageKey(account.id), JSON.stringify(PAYMENT_METHODS.filter(m => methods.includes(m))));
  window.dispatchEvent(new CustomEvent("finnos:payment-methods-changed", { detail: account.id }));
}
