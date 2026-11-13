/**
 * One default per kind of payment (mirror of finnos/lib/wallet_defaults.py):
 * a bank account, a credit card, a benefit, cash. When nobody chose one, the
 * oldest active item of each kind is preselected.
 */
import type { Account, AccountType, CreditCard } from "@/types/finnos";

export type DefaultScope = "account" | "benefit" | "cash" | "card";

export function accountScope(type: AccountType | undefined): DefaultScope {
  if (type === "beneficio") return "benefit";
  if (type === "carteira") return "cash";
  return "account";
}

interface Flagged { id: string; is_default?: boolean; active?: boolean; created_at?: string }

export function effectiveDefaults<T extends Flagged>(items: T[], scope: (item: T) => DefaultScope): Set<string> {
  const chosen = new Map<DefaultScope, string>();
  for (const item of items) if (item.is_default && item.active !== false && !chosen.has(scope(item))) chosen.set(scope(item), item.id);
  for (const item of [...items].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))) {
    if (item.active !== false && !chosen.has(scope(item))) chosen.set(scope(item), item.id);
  }
  return new Set(chosen.values());
}

/** The account to preselect for Pix/debit (or for a benefit or cash when asked). */
export function defaultAccount(accounts: Account[], scope: DefaultScope = "account"): Account | undefined {
  const active = accounts.filter((a) => a.active !== false);
  const inScope = active.filter((a) => accountScope(a.type) === scope);
  return inScope.find((a) => a.is_default) ?? inScope[0] ?? active.find((a) => a.is_default) ?? active[0];
}

export function defaultCard(cards: CreditCard[]): CreditCard | undefined {
  const active = cards.filter((c) => c.active !== false);
  return active.find((c) => c.is_default) ?? active[0];
}
