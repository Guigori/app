import { ApiError } from "@/lib/api";
import { formatBRL } from "@/lib/format";

/** Approved 12/11/2026: money leaving an account (invoice payment, transfer)
 * may not take it below zero, unless the account has a cheque especial, the
 * result stays within its limit and the person confirms. Same rule as
 * finnos/lib/account_funds.py. */
export type FundsCode = "saldo_insuficiente" | "confirmar_cheque_especial";

export interface FundsIssue {
  code: FundsCode;
  message: string;
  available: number;
  amount: number;
  overdraft_limit: number;
}

export class FundsError extends Error implements FundsIssue {
  code: FundsCode;
  available: number;
  amount: number;
  overdraft_limit: number;

  constructor(issue: FundsIssue) {
    super(issue.message);
    this.name = "FundsError";
    this.code = issue.code;
    this.available = issue.available;
    this.amount = issue.amount;
    this.overdraft_limit = issue.overdraft_limit;
  }
}

const toCents = (value: number) => Math.round(value * 100);

/** Pure check (local mode); throws FundsError when the amount does not fit. */
export function checkFunds(balance: number, amount: number, account: { name?: string; overdraft_limit?: number | null }, allowOverdraft: boolean): void {
  const available = toCents(balance);
  const after = available - toCents(amount);
  if (after >= 0) return;
  const limit = Math.max(0, toCents(account.overdraft_limit ?? 0));
  const base = { available: available / 100, amount, overdraft_limit: limit / 100 };
  if (limit && after >= -limit) {
    if (allowOverdraft) return;
    throw new FundsError({ ...base, code: "confirmar_cheque_especial", message: `Vai usar ${formatBRL(-after / 100)} do cheque especial. Confirme para continuar.` });
  }
  throw new FundsError({ ...base, code: "saldo_insuficiente", message: `Saldo insuficiente em ${account.name || "conta"}: disponível ${formatBRL(available / 100)}.` });
}

/** The funds problem behind an error from the API or the local engine, if any. */
export function fundsIssue(error: unknown): FundsIssue | null {
  if (error instanceof FundsError) return error;
  if (error instanceof ApiError) {
    const detail = (error.body as { detail?: unknown } | null)?.detail as Partial<FundsIssue> | undefined;
    if (detail && typeof detail === "object" && (detail.code === "saldo_insuficiente" || detail.code === "confirmar_cheque_especial")) {
      return detail as FundsIssue;
    }
  }
  return null;
}
