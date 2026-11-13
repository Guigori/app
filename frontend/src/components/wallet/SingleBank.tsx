import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { fetchTransactions } from "@/lib/data";
import { monthSpendByMethod } from "@/lib/walletSpend";
import { cardGradient } from "@/lib/cardGradient";
import type { BankRow } from "@/lib/walletSummary";
import { currentMonth, formatBRL, formatHiddenBRL } from "@/lib/format";

type Kind = "banco" | "cartao" | "beneficio";

/** Prototype "15 · Com 1 banco": with a single bank (and no benefits) the Carteira is that bank's card,
 * the two main actions, the month by payment method and an invite to add the rest. */
export function SingleBank({ bank, hidden, onAdd }: { bank: BankRow; hidden: boolean; onAdd: (kind: Kind) => void }) {
  const month = currentMonth();
  const monthQueries = useQueries({
    queries: bank.accounts.map((a) => ({ queryKey: ["transactions", { month, account_id: a.id }], queryFn: () => fetchTransactions({ month, account_id: a.id }) })),
  });
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const monthTx = monthQueries.flatMap((q) => q.data ?? []);
  const spendRows = new Map<string, number>();
  for (const a of bank.accounts) for (const r of monthSpendByMethod(a, monthTx, [], month).rows) spendRows.set(r.label, (spendRows.get(r.label) ?? 0) + r.value);
  const credit = bank.cards.reduce((s, c) => s + c.current_invoice, 0);
  if (credit > 0) spendRows.set("Crédito", credit);
  const spend = [...spendRows.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const total = spend.reduce((s, r) => s + r.value, 0);
  const shades = [bank.color, `color-mix(in srgb, ${bank.color} 60%, white)`, `color-mix(in srgb, ${bank.color} 25%, white)`, `color-mix(in srgb, ${bank.color} 12%, white)`];

  const card = [...bank.cards].sort((a, b) => (b.payable_invoice ?? 0) - (a.payable_invoice ?? 0) || b.current_invoice - a.current_invoice)[0];
  const openInvoice = bank.cards.reduce((s, c) => s + (c.payable_invoice ?? 0) + c.current_invoice, 0);
  const freeLimit = bank.cards.reduce((s, c) => s + (c.available), 0);
  const balance = (bank.accountsCents ?? 0) / 100;
  const tile = "rounded-2xl bg-white/15 px-3 py-2.5";

  return (
    <div className="space-y-3" data-testid="wallet-single-bank">
      <Link to={`/contas/banco/${encodeURIComponent(bank.key)}`} className="block rounded-[28px] p-5 text-white" style={{ background: cardGradient(bank.color) }} data-testid="wallet-single-bank-card">
        <span className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-[13px] bg-white/20 font-heading font-bold">{bank.initials}</span>
          <span className="min-w-0 flex-1 truncate text-base font-bold">{bank.name}</span>
          {bank.isDefault ? <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold">Padrão</span> : null}
        </span>
        {bank.accountsCents != null ? (<>
          <span className="mt-5 block text-[13px] opacity-85">Saldo da conta</span>
          <span className="block font-heading text-[34px] font-bold tracking-[-0.02em] tabular-nums">{money(balance)}</span>
        </>) : <span className="mt-5 block text-[13px] opacity-85">Só cartão de crédito</span>}
        {card ? (
          <span className="mt-4 grid grid-cols-2 gap-2.5">
            <span className={tile}><span className="block text-[11px] opacity-85">Fatura aberta</span><strong className="text-[15px] tabular-nums">{money(openInvoice)}</strong></span>
            <span className={tile}><span className="block text-[11px] opacity-85">Limite livre</span><strong className="text-[15px] tabular-nums">{money(freeLimit)}</strong></span>
          </span>
        ) : null}
      </Link>

      {card ? (
        <div className="grid grid-cols-2 gap-2">
          <Link to={`/cartoes/${encodeURIComponent(card.id)}?pagar=1`} className="grid h-12 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground" data-testid="wallet-single-pay">Pagar fatura</Link>
          <Link to={`/cartoes/${encodeURIComponent(card.id)}`} className="grid h-12 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">Ver o cartão</Link>
        </div>
      ) : bank.accounts[0] ? (
        <div className="grid grid-cols-2 gap-2">
          <Link to={`/contas/${encodeURIComponent(bank.accounts[0].id)}/conferencia`} className="grid h-12 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">Conferir extrato</Link>
          <Link to={`/contas/banco/${encodeURIComponent(bank.key)}`} className="grid h-12 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">Ver o banco</Link>
        </div>
      ) : null}

      <h2 className="mx-1 pt-3 font-heading text-lg font-bold">Este mês</h2>
      <div className="rounded-3xl border border-border bg-card p-4" data-testid="wallet-single-month">
        {total > 0 ? (<>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {spend.map((r, i) => <span key={r.label} style={{ width: `${(r.value / total) * 100}%`, background: shades[Math.min(i, shades.length - 1)] }} />)}
          </div>
          <ul className="mt-3.5 space-y-2 text-[13px]">
            {spend.map((r, i) => (
              <li key={r.label} className="flex items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: shades[Math.min(i, shades.length - 1)] }} />
                <span className="min-w-0 flex-1 truncate">{r.label}</span><strong className="tabular-nums">{money(r.value)}</strong>
              </li>
            ))}
          </ul>
        </>) : <p className="text-[13px] text-muted-foreground">Nenhum gasto neste mês ainda.</p>}
      </div>

      <div className="mt-2 rounded-3xl border-[1.5px] border-dashed border-primary/35 p-[18px]">
        <p className="text-[15px] font-bold">Tem mais algum?</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Outro banco, VR ou dinheiro: junte para ver tudo o que você tem.</p>
        <div className="mt-3.5 flex gap-2">
          {([["banco", "Banco"], ["cartao", "Cartão"], ["beneficio", "Benefício"]] as const).map(([kind, label]) => (
            <button key={kind} type="button" onClick={() => onAdd(kind)} className="h-[42px] flex-1 rounded-full border border-border bg-card text-[13px] font-bold" data-testid={`wallet-single-add-${kind}`}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
