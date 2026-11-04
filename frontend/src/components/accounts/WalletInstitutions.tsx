import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, ChevronUp, CreditCard, Eye, EyeOff, Pencil, Wallet } from "lucide-react";
import { walletGroups } from "@/lib/institutionGroups";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import type { Account, CreditCard as CardType, Institution } from "@/types/finnos";
import { Button } from "@/components/ui/button";

export function WalletInstitutions({
  accounts, cards, institutions, onOpenAccount, onEditCard,
}: {
  accounts: Account[];
  cards: CardType[];
  institutions: Institution[];
  onOpenAccount: (account: Account) => void;
  onEditCard: (card: CardType) => void;
}) {
  const groups = walletGroups(accounts, cards, institutions);
  const { hidden, toggle } = useBalanceHidden();
  const [closed, setClosed] = useState<string[]>([]);
  const money = (value: number) => hidden ? formatHiddenBRL() : formatBRL(value);
  const totalCents = accounts.reduce((sum, account) => sum + Math.round(account.balance * 100), 0);
  // App-like list: balance on top, one row per account or card, grouped by institution.
  // Row tap opens the account detail (payments, edit, delete) or the card invoice.
  return <div className="space-y-5" data-testid="wallet-institutions">
    <section className="rounded-[24px] border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">Saldo da carteira</span>
        <Button size="icon-sm" variant="ghost" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}>{hidden ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</Button>
      </div>
      <p className="mt-1 font-heading text-3xl font-bold tabular-nums" data-testid="wallet-balance" title="Somente saldos de contas; limites de cartões não entram no total.">{money(totalCents / 100)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{groups.length} {groups.length === 1 ? "instituição" : "instituições"} · {cards.length} {cards.length === 1 ? "cartão" : "cartões"}</p>
    </section>
    {groups.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhuma conta ou cartão cadastrado.</div> : groups.map(group => {
      const collapsed = closed.includes(group.key);
      return <section key={group.key} data-testid={"wallet-group-" + group.key}>
        <button type="button" onClick={() => setClosed(current => collapsed ? current.filter(key => key !== group.key) : [...current, group.key])} aria-expanded={!collapsed} aria-label={collapsed ? "Expandir instituição" : "Recolher instituição"} className="flex w-full items-center justify-between gap-3 px-1 pb-2 text-left">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.color }} aria-hidden="true"/>
            <span className="truncate text-sm font-semibold text-muted-foreground">{group.name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums text-muted-foreground">{money(group.balanceCents / 100)}{collapsed ? <ChevronDown className="h-4 w-4"/> : <ChevronUp className="h-4 w-4"/>}</span>
        </button>
        {!collapsed && <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {group.accounts.map(account => <button key={account.id} type="button" onClick={() => onOpenAccount(account)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 active:bg-muted" data-testid={"wallet-account-" + account.id}>
            <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: group.color + "1F", color: group.color }}><Wallet className="h-5 w-5"/></span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{account.name}</span>{!account.active ? <span className="block text-xs text-muted-foreground">Inativa</span> : null}</span>
            <span className={"shrink-0 font-heading font-semibold tabular-nums " + (account.balance < 0 ? "text-expense" : "")}>{money(account.balance)}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true"/>
          </button>)}
          {group.cards.map(card => <div key={card.id} className="flex items-center gap-3 px-4 py-3.5" data-testid={"wallet-card-" + card.id}>
            <Link to={"/cartoes/" + card.id} className="flex min-w-0 flex-1 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><CreditCard className="h-5 w-5"/></span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{card.name}</span><span className="block truncate text-xs text-muted-foreground">Fatura {money(card.current_invoice)} · paga com {card.payment_account_name ?? "conta não definida"}</span></span>
            </Link>
            <Button size="icon-sm" variant="ghost" onClick={() => onEditCard(card)} aria-label={"Editar " + card.name}><Pencil className="h-4 w-4"/></Button>
          </div>)}
          {group.accounts.length === 0 && group.cards.length === 0 && <p className="px-4 py-3.5 text-sm text-muted-foreground">Nenhuma conta ou cartão aqui ainda.</p>}
        </div>}
      </section>;
    })}
  </div>;
}
