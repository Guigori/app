import type { Account, CreditCard, Institution } from "@/types/finnos";

export function institutionKey(label: string): string {
  return label.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export interface WalletGroup {
  key: string;
  name: string;
  color: string;
  institutionId: string | null;
  accounts: Account[];
  cards: CreditCard[];
  balanceCents: number;
}

/** Read-only grouping: never changes Firestore/IndexedDB records or IDs. */
export function walletGroups(accounts: Account[], cards: CreditCard[], institutions: Institution[]): WalletGroup[] {
  const registry = new Map(institutions.map(item => [item.id, item]));
  const names = new Map(institutions.map(item => [institutionKey(item.name), item]));
  const groups = new Map<string, WalletGroup>();
  const resolve = (id: string | null | undefined, name: string) => {
    const known = (id && registry.get(id)) || names.get(institutionKey(name));
    const norm = institutionKey(name);
    const key = known ? `registered:${known.id}` : norm ? `legacy:${norm}` : "unassigned";
    let group = groups.get(key);
    if (!group) {
      group = {
        key, institutionId: known?.id ?? null,
        name: (known?.name ?? name.trim().replace(/\s+/g, " ")) || "Sem instituição",
        color: known?.color ?? "#5B35FF",
        accounts: [], cards: [], balanceCents: 0,
      };
      groups.set(key, group);
    }
    return group;
  };
  for (const institution of institutions) resolve(institution.id, institution.name);
  for (const account of accounts) {
    const group = resolve(account.institution_id, account.institution);
    group.accounts.push(account);
    group.balanceCents += Math.round(account.balance * 100);
  }
  for (const card of cards) resolve(card.institution_id, card.institution).cards.push(card);
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name, "pt-BR"));
}
