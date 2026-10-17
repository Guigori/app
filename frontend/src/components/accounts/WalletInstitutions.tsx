import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, CreditCard, Eye, EyeOff, Landmark, Pencil, Trash2, Wallet } from "lucide-react";
import { walletGroups } from "@/lib/institutionGroups";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import type { Account, CreditCard as CardType, Institution } from "@/types/finnos";
import { Button } from "@/components/ui/button";

export function WalletInstitutions({
  accounts, cards, institutions, onOpenAccount, onEditAccount, onDeleteAccount, onPaymentMethods, onEditCard,
}: {
  accounts: Account[];
  cards: CardType[];
  institutions: Institution[];
  onOpenAccount: (account: Account) => void;
  onEditAccount: (account: Account) => void;
  onDeleteAccount: (account: Account) => void;
  onPaymentMethods: (account: Account) => void;
  onEditCard: (card: CardType) => void;
}) {
  const groups = walletGroups(accounts, cards, institutions);
  const { hidden, toggle } = useBalanceHidden();
  const [closed, setClosed] = useState<string[]>([]);
  const money = (value: number) => hidden ? formatHiddenBRL() : formatBRL(value);
  const totalCents = accounts.reduce((sum, account) => sum + Math.round(account.balance * 100), 0);
  return <div className="space-y-5" data-testid="wallet-institutions">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="col-span-2 rounded-[24px] border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Saldo da Carteira</span>
          <Button size="icon-sm" variant="ghost" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}>{hidden ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</Button>
        </div>
        <p className="mt-3 font-heading text-2xl font-bold tabular-nums" data-testid="wallet-balance">{money(totalCents / 100)}</p>
        <p className="mt-2 text-xs text-muted-foreground">Somente saldos de contas; limites de cartões não entram no total.</p>
      </div>
      <div className="rounded-[24px] border border-border bg-card p-4"><Landmark className="h-5 w-5 text-primary"/><p className="mt-3 font-heading text-2xl font-bold">{groups.length}</p><p className="text-xs text-muted-foreground">Instituições</p></div>
      <div className="rounded-[24px] border border-border bg-card p-4"><CreditCard className="h-5 w-5 text-primary"/><p className="mt-3 font-heading text-2xl font-bold">{cards.length}</p><p className="text-xs text-muted-foreground">Cartões</p></div>
    </div>
    <div className="space-y-4">
      <div><h2 className="font-heading text-lg font-bold">Instituições financeiras</h2><p className="text-xs text-muted-foreground">O emissor do cartão pode ser diferente da conta usada no pagamento.</p></div>
      {groups.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhuma conta ou cartão cadastrado. Use os botões acima para começar.</div> : groups.map(group => {
        const collapsed = closed.includes(group.key);
        return <section key={group.key} className="overflow-hidden rounded-[24px] border border-border bg-card" data-testid={"wallet-group-" + group.key}>
          <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: group.color + "1A", color: group.color }}><Landmark className="h-5 w-5"/></span>
              <div className="min-w-0"><h3 className="truncate font-heading font-bold">{group.name}</h3><p className="text-xs text-muted-foreground">{group.accounts.length} conta(s) · {group.cards.length} cartão(ões){!group.institutionId ? " · vínculo legado" : ""}</p></div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="text-right"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Saldo</p><p className="font-heading text-sm font-bold tabular-nums">{money(group.balanceCents / 100)}</p></div>
              <Button variant="ghost" size="icon-sm" aria-label={collapsed ? "Expandir instituição" : "Recolher instituição"} onClick={() => setClosed(current => collapsed ? current.filter(key => key !== group.key) : [...current,group.key])}>{collapsed ? <ChevronDown className="h-4 w-4"/> : <ChevronUp className="h-4 w-4"/>}</Button>
            </div>
          </div>
          {!collapsed && <div className="space-y-4 p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {group.accounts.map(account => <div key={account.id} className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4" data-testid={"wallet-account-" + account.id}>
                <button type="button" onClick={() => onOpenAccount(account)} className="w-full text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold"><Wallet className="h-4 w-4 text-primary"/>{account.name}{!account.active && <span className="text-xs text-muted-foreground">Inativa</span>}</p>
                  <p className="mt-2 font-heading text-xl font-bold tabular-nums">{money(account.balance)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Entradas: {money(account.total_income)} · Saídas: {money(account.total_expense)}</p>
                </button>
                <div className="flex flex-wrap gap-1 border-t border-border pt-2">
                  <Button variant="ghost" size="sm" onClick={() => onPaymentMethods(account)}>Pagamentos</Button>
                  <Button variant="ghost" size="sm" onClick={() => onEditAccount(account)}><Pencil className="h-3.5 w-3.5"/> Editar</Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onDeleteAccount(account)} aria-label={"Excluir " + account.name}><Trash2 className="h-3.5 w-3.5"/></Button>
                </div>
              </div>)}
            </div>
            {group.cards.length > 0 && <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cartões de crédito</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.cards.map(card => <div key={card.id} className="rounded-2xl border border-border bg-muted/20 p-4" data-testid={"wallet-card-" + card.id}>
                  <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4 text-primary"/>{card.name}</p><Button size="sm" variant="ghost" onClick={() => onEditCard(card)}>Editar</Button></div>
                  <p className="mt-2 text-xs text-muted-foreground">Fatura: {money(card.current_invoice)} · Limite disponível: {money(card.available)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Pagamento: {card.payment_account_name ?? "não definido"}</p>
                  <Link to={"/cartoes/" + card.id} className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">Ver fatura</Link>
                </div>)}
              </div>
            </div>}
            {group.accounts.length === 0 && group.cards.length === 0 && <p className="text-xs text-muted-foreground">Instituição cadastrada. Adicione uma conta ou cartão.</p>}
          </div>}
        </section>;
      })}
    </div>
  </div>;
}
