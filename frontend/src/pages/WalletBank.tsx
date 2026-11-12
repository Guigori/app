import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowLeftRight, ChevronRight, CreditCard as CardIcon, Diamond, Eye, EyeOff, Landmark, ListChecks, Pencil, Settings, Sparkles } from "lucide-react";
import { fetchAccounts, fetchCards, fetchInstitutions, fetchTransactions } from "@/lib/data";
import { walletGroups } from "@/lib/institutionGroups";
import { monthSpendByMethod } from "@/lib/walletSpend";
import { useBalanceHidden } from "@/lib/balance";
import { currentMonth, formatBRL, formatHiddenBRL } from "@/lib/format";
import { askAbout } from "@/lib/askAi";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { useOwnHeader } from "@/components/layout/BackButton";
import { AccountDetailDialog } from "@/components/accounts/AccountDetailDialog";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { cn } from "@/lib/utils";
import type { Account } from "@/types/finnos";

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Prototype "2 · Banco": everything of one bank — balance, invoice, shortcuts, payment methods and the month. */
export default function WalletBank() {
  const { bankKey = "" } = useParams();
  const dialogs = useDialogs();
  useOwnHeader();
  const { hidden, toggle } = useBalanceHidden();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const institutionsQuery = useQuery({ queryKey: ["institutions"], queryFn: fetchInstitutions });
  const allAccounts = accountsQuery.data ?? [];
  const cards = cardsQuery.data ?? [];
  const group = walletGroups(allAccounts.filter((a) => a.type !== "beneficio" && a.type !== "carteira"), cards.filter((c) => c.active), institutionsQuery.data ?? [])
    .find((g) => g.key === bankKey);
  const month = currentMonth();
  const monthQueries = useQueries({
    queries: (group?.accounts ?? []).map((a) => ({ queryKey: ["transactions", { month, account_id: a.id }], queryFn: () => fetchTransactions({ month, account_id: a.id }) })),
  });
  const [selected, setSelected] = useState<Account | null>(null);
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));

  if (accountsQuery.isPending || cardsQuery.isPending || institutionsQuery.isPending) return <FinnosPageLoading title="Carregando banco" description="Juntando contas e cartões." />;
  if (!group) {
    return (
      <div className="mx-auto max-w-[560px] space-y-4 py-10 text-center">
        <p className="font-heading text-lg font-semibold">Banco não encontrado</p>
        <Link to="/contas" className="font-semibold text-primary">Voltar para a Carteira</Link>
      </div>
    );
  }
  const brand = group.color;
  const primary = group.accounts.find((a) => a.is_default) ?? group.accounts[0];
  const balance = group.accounts.reduce((s, a) => s + a.balance, 0);
  const owed = group.cards.reduce((s, c) => s + (c.payable_invoice ?? 0) + c.current_invoice, 0);
  const payCard = [...group.cards].sort((a, b) => (b.payable_invoice ?? 0) - (a.payable_invoice ?? 0) || b.current_invoice - a.current_invoice)[0];
  const dueOf = (c: typeof payCard) => (c.payable_invoice ? c.payable_due ?? c.next_due : c.next_due);
  const monthTx = monthQueries.flatMap((q) => q.data ?? []);
  // Month by payment method: each account's direct spending plus the open invoice of the bank's cards.
  const spendRows = new Map<string, number>();
  for (const a of group.accounts) for (const r of monthSpendByMethod(a, monthTx, [], month).rows) spendRows.set(r.label, (spendRows.get(r.label) ?? 0) + r.value);
  const creditMonth = group.cards.reduce((s, c) => s + c.current_invoice, 0);
  if (creditMonth > 0) spendRows.set("Crédito", creditMonth);
  const spend = [...spendRows.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const spendTotal = spend.reduce((s, r) => s + r.value, 0);
  const methodMonth = (m: string) => spendRows.get(m) ?? 0;
  const shades = [brand, `color-mix(in srgb, ${brand} 60%, white)`, `color-mix(in srgb, ${brand} 25%, white)`, `color-mix(in srgb, ${brand} 12%, white)`];
  const tint = `color-mix(in srgb, ${brand} 12%, transparent)`;

  const shortcut = "flex flex-col items-center gap-1.5 rounded-[20px] border border-border bg-card px-1 py-3 text-xs font-semibold text-foreground";
  const icon = (node: React.ReactNode) => <span className="grid size-[38px] place-items-center rounded-[13px]" style={{ background: tint, color: brand }}>{node}</span>;

  return (
    <div className="-mx-4 -mt-4 animate-fade-up sm:mx-auto sm:mt-0 sm:max-w-[560px]" data-testid="wallet-bank-page">
      <section className="rounded-b-[32px] px-5 pb-12 pt-5 text-white sm:rounded-[32px]" style={{ background: brand }}>
        <div className="flex items-center gap-3">
          <Link to="/contas" aria-label="Voltar" className="grid size-11 place-items-center rounded-full bg-white/15"><ArrowLeft className="size-5" /></Link>
          <h1 className="min-w-0 flex-1 truncate font-heading text-[22px] font-bold">{group.name}</h1>
          <button type="button" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} className="grid size-11 place-items-center rounded-full bg-white/15">
            {hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
          {primary ? (
            <button type="button" onClick={() => dialogs.openAccount(primary)} aria-label="Configurar conta" className="grid size-11 place-items-center rounded-full bg-white/15"><Pencil className="size-[18px]" /></button>
          ) : null}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <div><p className="text-xs opacity-80">Saldo da conta</p><p className="mt-1 font-heading text-2xl font-bold tabular-nums" data-testid="wallet-bank-balance">{primary ? money(balance) : "—"}</p></div>
          <div><p className="text-xs opacity-80">Fatura aberta</p><p className="mt-1 font-heading text-2xl font-bold tabular-nums">{group.cards.length ? money(owed) : "—"}</p></div>
        </div>
        {payCard && owed > 0 ? (
          <p className="mt-3.5 text-[13px] opacity-85">A fatura de <span className="tabular-nums">{money((payCard.payable_invoice ?? 0) || payCard.current_invoice)}</span> vence em {ddmm(dueOf(payCard))}. Você escolhe a conta na hora de pagar.</p>
        ) : null}
      </section>

      <div className="relative mx-5 -mt-[22px] grid grid-cols-4 gap-2">
        {primary ? (
          <button type="button" className={shortcut} onClick={() => dialogs.openAccount(primary)} data-testid="wallet-bank-configure">{icon(<Settings className="size-[18px]" />)}Configurar</button>
        ) : <span className={cn(shortcut, "opacity-40")}>{icon(<Settings className="size-[18px]" />)}Configurar</span>}
        <button type="button" className={cn(shortcut, !primary && "opacity-40")} disabled={!primary} data-testid="wallet-bank-transfer"
          onClick={() => primary && dialogs.openTransaction({ type: "transferencia", prefill: { type: "transferencia", account_id: primary.id } })}>{icon(<ArrowLeftRight className="size-[18px]" />)}Transferir</button>
        {payCard ? (
          <Link to={`/cartoes/${encodeURIComponent(payCard.id)}?pagar=1`} className={shortcut} data-testid="wallet-bank-pay">{icon(<CardIcon className="size-[18px]" />)}Pagar fatura</Link>
        ) : <span className={cn(shortcut, "opacity-40")}>{icon(<CardIcon className="size-[18px]" />)}Pagar fatura</span>}
        {primary ? (
          <Link to={`/contas/${encodeURIComponent(primary.id)}/conferencia`} className={shortcut} data-testid="wallet-bank-reconcile">{icon(<ListChecks className="size-[18px]" />)}Conferir extrato</Link>
        ) : <span className={cn(shortcut, "opacity-40")}>{icon(<ListChecks className="size-[18px]" />)}Conferir extrato</span>}
      </div>

      <div className="px-5 pb-8">
        <h2 className="mx-1 mb-2.5 mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Formas de pagamento</h2>
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          {group.accounts.map((a) => (
            <button key={a.id} type="button" onClick={() => setSelected(a)} className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-3.5 text-left" data-testid={`wallet-account-${a.id}`}>
              {icon(<Landmark className="size-[18px]" />)}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-semibold">{group.accounts.length > 1 ? a.name : "Conta"}{a.is_default ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">Padrão</span> : null}</span>
                <span className="block text-xs text-muted-foreground">{a.overdraft_limit ? `Cheque especial de ${money(a.overdraft_limit)}` : "Tem saldo"}</span>
              </span>
              <span className={cn("font-bold tabular-nums", a.balance < 0 && "text-expense")}>{money(a.balance)}</span>
            </button>
          ))}
          {group.accounts.length ? (methodMonth("Pix") || methodMonth("Débito") || !methodMonth("Pix ou débito") ? ["Pix", "Débito"] as const : ["Pix ou débito"] as const).map((m) => (
            <div key={m} className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5">
              {icon(m === "Débito" ? <CardIcon className="size-[18px]" /> : <Diamond className="size-[18px]" />)}
              <span className="min-w-0 flex-1"><span className="block font-semibold">{m}</span><span className="block text-xs text-muted-foreground">Sai do saldo da conta</span></span>
              <span className="text-[13px] text-muted-foreground"><span className="tabular-nums">{money(methodMonth(m))}</span> no mês</span>
            </div>
          )) : null}
          {group.cards.map((c) => (
            <Link key={c.id} to={`/cartoes/${encodeURIComponent(c.id)}`} className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 text-foreground last:border-b-0" data-testid={`wallet-card-${c.id}`}>
              <span className="grid size-[38px] place-items-center rounded-[13px] text-white" style={{ background: brand }}><CardIcon className="size-[18px]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{group.cards.length > 1 ? c.name : "Crédito"}{c.last_digits ? ` · •••• ${c.last_digits}` : ""}</span>
                <span className="block text-xs text-muted-foreground">Vai para a fatura · fecha dia {Number(c.next_closing.slice(8, 10))}, vence dia {Number(c.next_due.slice(8, 10))}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
        </div>

        {spend.length ? (
          <>
            <h2 className="mx-1 mb-2.5 mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Este mês no {group.name}</h2>
            <div className="rounded-3xl border border-border bg-card p-4" data-testid="wallet-bank-month">
              <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full">
                {spend.map((r, i) => <span key={r.label} style={{ width: `${(r.value / spendTotal) * 100}%`, background: shades[Math.min(i, shades.length - 1)] }} />)}
              </div>
              <div className="mt-3.5 flex flex-col gap-2 text-[13px]">
                {spend.map((r, i) => (
                  <span key={r.label} className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: shades[Math.min(i, shades.length - 1)] }} />
                    <span className="flex-1">{r.label}</span><strong className="tabular-nums">{money(r.value)}</strong>
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : null}
        <button type="button" className="mx-1 mt-4 flex items-center gap-1.5 text-sm font-semibold text-primary"
          onClick={() => askAbout(`Me ajude a entender o ${group.name}: saldo, fatura e os gastos do mês.`, { banco: group.name, saldo: balance, fatura: owed, gasto_mes: spend })}>
          <Sparkles className="size-4" aria-hidden="true" />Conversar sobre isso
        </button>
      </div>

      <AccountDetailDialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }} account={selected} cards={cards}
        onEdit={(a) => { setSelected(null); dialogs.openAccount(a); }} onDelete={() => setSelected(null)} />
    </div>
  );
}
