import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff, Pencil } from "lucide-react";
import { fetchAccounts, fetchTransactions } from "@/lib/data";
import { formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { cn } from "@/lib/utils";
import { useOwnHeader } from "@/components/layout/BackButton";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BENEFIT_GRADIENTS } from "@/lib/benefitColors";
import type { Transaction } from "@/types/finnos";

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dayMs = 86400000;
const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

/** Weekdays from tomorrow up to the day before ``end`` (benefit allowance "por dia útil"). */
export function workdaysUntil(today: string, end: string): number {
  let n = 0;
  for (let t = at(today) + dayMs; t < at(end); t += dayMs) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return Math.max(1, n);
}

/** Prototype "9 · Benefício". A multi card shows one chip per benefit on top. */
export default function WalletBenefit() {
  const { accountId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  useOwnHeader();
  const { hidden, toggle } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const account = accountsQuery.data?.find((a) => a.id === accountId);
  const txQuery = useQuery({ queryKey: ["transactions", { account_id: accountId }], queryFn: () => fetchTransactions({ account_id: accountId }), enabled: !!account });
  if (accountsQuery.isPending) return <FinnosPageLoading title="Carregando benefício" description="Buscando saldo e recargas." />;
  if (!account) return <p className="py-10 text-center text-muted-foreground">Benefício não encontrado. <Link to="/contas" className="font-semibold text-primary">Voltar</Link></p>;

  const wallets = account.wallets ?? [];
  const fallback = wallets.find((w) => w.is_default)?.id ?? wallets[0]?.id;
  const walletIndex = Math.max(0, wallets.findIndex((w) => w.id === params.get("b")));
  const wallet = wallets[walletIndex];
  const today = todayISO();
  const mine = (t: Transaction) => !wallet || (t.wallet_id || fallback) === wallet.id
    || (t.type === "transferencia" && t.to_account_id === account.id && (t.to_wallet_id || fallback) === wallet.id);
  const txs = (txQuery.data ?? []).filter((t) => t.status === "pago" && t.date <= today && mine(t)).sort((a, b) => b.date.localeCompare(a.date));
  const lastRecharge = txs.find((t) => t.benefit_recharge);
  const since = lastRecharge?.date ?? today.slice(0, 8) + "01";
  const spentTx = txs.filter((t) => t.type === "despesa" && !t.card_id && t.date >= since && !t.balance_adjustment);
  const spent = spentTx.reduce((s, t) => s + t.value, 0);
  const balance = wallet?.balance ?? account.balance;
  const next = wallet?.next_recharge ?? null;
  const received = lastRecharge?.value ?? wallet?.monthly_amount ?? 0;
  const cycleDays = next ? Math.max(1, Math.round((at(next) - at(since)) / dayMs)) : 30;
  const dayOfCycle = Math.min(cycleDays, Math.max(1, Math.round((at(today) - at(since)) / dayMs) + 1));
  const spentShare = received > 0 ? Math.min(1, spent / received) : 0;
  const perWorkday = next && balance > 0 ? balance / workdaysUntil(today, next) : 0;
  const month = today.slice(0, 7);
  const usesMonth = txs.filter((t) => t.type === "despesa" && t.date.startsWith(month) && !t.balance_adjustment);
  const average = usesMonth.length ? usesMonth.reduce((s, t) => s + t.value, 0) / usesMonth.length : 0;
  const title = wallet && (wallets.length > 1 || wallet.name !== account.name) ? wallet.name : account.name;
  const gradient = BENEFIT_GRADIENTS[walletIndex % BENEFIT_GRADIENTS.length];

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3.5 pb-10" data-testid="benefit-page">
      <header className="flex items-center gap-3">
        <Link to="/contas?aba=beneficios" aria-label="Voltar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><ArrowLeft className="size-5" /></Link>
        <h1 className="min-w-0 flex-1 truncate font-heading text-xl font-bold" data-testid="benefit-title">{title}</h1>
        <button type="button" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card">{hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
        <Link to={`/contas/beneficio/${encodeURIComponent(account.id)}/configurar`} aria-label="Configurar benefício" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card" data-testid="benefit-configure"><Pencil className="size-[19px]" /></Link>
      </header>

      {wallets.length > 1 ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Benefícios do cartão">
          {wallets.map((w, i) => (
            <button key={w.id} type="button" role="tab" aria-selected={i === walletIndex} onClick={() => setParams({ b: w.id }, { replace: true })} data-testid={`benefit-chip-${w.id}`}
              className={cn("shrink-0 rounded-2xl px-3.5 py-2 text-left", i === walletIndex ? "text-white" : "border border-border bg-card")} style={i === walletIndex ? { background: BENEFIT_GRADIENTS[i % BENEFIT_GRADIENTS.length] } : undefined}>
              <span className="block text-xs font-semibold">{w.name}</span><span className="block font-heading text-sm font-bold tabular-nums">{money(w.balance)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex h-[190px] flex-col justify-between rounded-3xl p-5 text-white" style={{ background: gradient }}>
        <div className="flex justify-between text-[13px] opacity-90"><span>{account.name} · {wallet?.name ?? "Benefício"}</span>{wallet?.monthly_amount ? <span>Recarga dia {wallet.day}</span> : null}</div>
        <div>
          <p className="text-xs opacity-85">Saldo</p>
          <p className="mt-0.5 font-heading text-[34px] font-bold tabular-nums" data-testid="benefit-balance">{money(balance)}</p>
          {lastRecharge ? <p className="mt-1.5 text-xs opacity-85">de <span className="tabular-nums">{money(lastRecharge.value)}</span> recebidos em {ddmm(lastRecharge.date)}</p> : null}
        </div>
      </div>

      {next ? (
        <section className="rounded-3xl border border-border bg-card p-4" data-testid="benefit-pace">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Ritmo até a próxima recarga</h2>
          <div className="relative mt-4 h-3 rounded-full bg-emerald-50 dark:bg-emerald-500/15">
            <span className="absolute inset-y-0 left-0 rounded-full bg-emerald-600" style={{ width: `${Math.round(spentShare * 100)}%` }} />
            <span className="absolute -top-[5px] h-[22px] w-0.5 bg-foreground" style={{ left: `${Math.round((dayOfCycle / cycleDays) * 100)}%` }} aria-hidden="true" />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>Gasto: <span className="tabular-nums">{money(spent)}</span></span><span>Hoje: dia {dayOfCycle} de {cycleDays}</span></div>
          <p className="mt-3.5 text-sm">
            {balance > 0 ? <>Dá para gastar <strong><span className="tabular-nums">{money(perWorkday)}</span> por dia útil</strong> até {ddmm(next)}.</> : <>Sem saldo até a recarga de {ddmm(next)}.</>}
            {wallet?.runs_out_on ? <> No ritmo atual, o saldo acaba por volta de {ddmm(wallet.runs_out_on)}.</> : balance > 0 ? " No ritmo atual, dá até a recarga." : null}
          </p>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-2.5">
        <div className="rounded-3xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Média por uso</p><p className="mt-1 font-heading text-xl font-bold tabular-nums">{money(average)}</p></div>
        <div className="rounded-3xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Usos no mês</p><p className="mt-1 font-heading text-xl font-bold">{usesMonth.length}</p></div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-border bg-card" data-testid="benefit-history">
        <h2 className="px-4 pb-1.5 pt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">O que foi gasto</h2>
        {txs.slice(0, 12).map((t, i) => {
          const income = t.type === "receita" || (t.type === "transferencia" && t.to_account_id === account.id && (t.to_wallet_id || fallback) === wallet?.id);
          return (
            <div key={t.id} className={cn("flex items-center gap-3 px-4 py-2.5", i > 0 && "border-t border-border/60", t.benefit_recharge && "bg-emerald-50/60 dark:bg-emerald-500/10")}>
              <span className="min-w-0 flex-1"><span className={cn("block truncate text-sm font-semibold", t.benefit_recharge && "text-emerald-700 dark:text-emerald-400")}>{t.benefit_recharge ? "Recarga mensal" : t.name}</span>
                <span className="block text-xs text-muted-foreground">{t.date === today ? "Hoje" : ddmm(t.date)}</span></span>
              <strong className={cn("shrink-0 text-sm tabular-nums", income && "text-emerald-700 dark:text-emerald-400")}>{income ? "+ " : ""}{money(t.value)}</strong>
            </div>
          );
        })}
        {txs.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum uso ainda.</p> : null}
      </section>
      <p className="px-2 text-center text-xs text-muted-foreground">Benefício não tem fatura: cada gasto sai do saldo{wallet?.monthly_amount ? `, e a recarga entra todo dia ${wallet.day}` : ""}.</p>
    </div>
  );
}
