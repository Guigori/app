import type { Transaction } from "@/types/finnos";

/** Account-relative presentation: transfers are incoming at the destination. */
export function signedAccountMovement(accountId: string, tx: Pick<Transaction, "type" | "value" | "account_id" | "to_account_id">): number {
  if (tx.type === "transferencia") {
    if (tx.to_account_id === accountId) return tx.value;
    if (tx.account_id === accountId) return -tx.value;
    return 0;
  }
  if (tx.account_id !== accountId) return 0;
  return tx.type === "receita" ? tx.value : -tx.value;
}
