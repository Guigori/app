import type { Account } from "@/types/finnos";
import { isLocalMode } from "@/lib/mode";
import { firebaseAuth, firestore } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export type PaymentMethod = "Pix" | "Débito" | "Dinheiro" | "Boleto";
export const PAYMENT_METHODS: PaymentMethod[] = ["Pix", "Débito", "Dinheiro", "Boleto"];
const storageKey = (id: string) => `finnos:payment-methods:local:${id}`;
const defaults = (account: Account): PaymentMethod[] => account.type === "carteira" ? ["Dinheiro"] : ["Pix", "Débito", "Boleto"];
const valid = (methods: unknown): PaymentMethod[] => Array.isArray(methods) ? PAYMENT_METHODS.filter(m => methods.includes(m)) : [];
export async function getAccountPaymentMethods(account: Account): Promise<PaymentMethod[]> {
  if (!isLocalMode()) {
    const uid = firebaseAuth?.currentUser?.uid;
    if (!uid || !firestore) throw new Error("É necessário autenticar-se para consultar as formas de pagamento.");
    const snapshot = await getDoc(doc(firestore, "users", uid, "accountPaymentMethods", account.id));
    return snapshot.exists() ? valid(snapshot.data().methods) : defaults(account);
  }
  try {
    const saved = localStorage.getItem(storageKey(account.id));
    return saved !== null ? valid(JSON.parse(saved)) : defaults(account);
  } catch { return defaults(account); }
}
export async function setAccountPaymentMethods(account: Account, methods: PaymentMethod[]): Promise<void> {
  const normalized = valid(methods);
  if (!isLocalMode()) {
    const uid = firebaseAuth?.currentUser?.uid;
    if (!uid || !firestore) throw new Error("É necessário autenticar-se para salvar as formas de pagamento.");
    await setDoc(doc(firestore, "users", uid, "accountPaymentMethods", account.id), { methods: normalized, updatedAt: new Date().toISOString() });
  } else {
    localStorage.setItem(storageKey(account.id), JSON.stringify(normalized));
  }
  window.dispatchEvent(new CustomEvent("finnos:payment-methods-changed", { detail: account.id }));
}
