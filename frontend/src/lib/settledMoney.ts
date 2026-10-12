import type { Transaction } from "@/types/finnos";
type FinancialTransaction = Pick<Transaction, "value" | "adjusted_value" | "type" | "status" | "date" | "installment" | "total_installments"> & { invoice_payment?: boolean };

/** Same paid/transfer/parcel rules as the Firestore financial service. */
export function settledCents(transaction: FinancialTransaction, month = transaction.date.slice(0, 7)): number {
  if (transaction.invoice_payment || transaction.status !== "pago" || transaction.type === "transferencia") return 0;
  const total = Math.round((transaction.adjusted_value ?? transaction.value) * 100);
  if (!Number.isSafeInteger(total)) throw new Error("Valor fora da precisão monetária suportada.");
  if (!transaction.installment) return transaction.date.slice(0, 7) === month ? total : 0;
  const n = transaction.total_installments ?? 1;
  const [year, startMonth] = transaction.date.slice(0, 7).split("-").map(Number);
  const [targetYear, targetMonth] = month.split("-").map(Number);
  const offset = (targetYear - year) * 12 + targetMonth - startMonth;
  if (offset < 0 || offset >= n) return 0;
  const base = Math.round(total / n);
  return offset === n - 1 ? total - base * (n - 1) : base;
}

export function settledTotals(transactions: FinancialTransaction[]) {
  let income = 0, expense = 0;
  for (const transaction of transactions) {
    const cents = settledCents(transaction);
    if (transaction.type === "receita") income += cents;
    if (transaction.type === "despesa") expense += cents;
  }
  return { income: income / 100, expense: expense / 100 };
}
