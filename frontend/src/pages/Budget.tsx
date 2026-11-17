/**
 * Orçamento · início (tela 1 do protótipo aprovado). Shows the month at a glance; everything shown comes from its own
 * module (Carteira, Fluxo, Assinaturas, Metas) through the device copy. The screen never writes: actions open the record
 * where it lives.
 */
import { Suspense } from "react";
import { lazyRetry } from "@/lib/lazyRetry";
import { useIsDesktop } from "@/components/budget/desktop/kit";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { monthLabel } from "@/lib/format";
import type { MonthView } from "@/lib/budget/monthView";
import { dismissMatch } from "@/lib/budget/prefs";
import { TransactionList } from "@/components/transactions/TransactionList";
import { BudgetHeader, card, dm, h2, useBudgetMonth, useMoney, useMonthData, useOnline } from "@/components/budget/shared";
import { BudgetFailed, BudgetLoading, NoBudgetCard, OfflineNote } from "@/components/budget/States";
import { NextStepCard } from "@/components/budget/NextStep";
import { HomeInsights, LimitsSummary, Shortcuts } from "@/components/budget/HomeParts";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/types/finnos";

const HomeDesktop = lazyRetry(() => import("@/components/budget/desktop/HomeDesktop"));

export default function Budget() {
  return useIsDesktop() ? <Suspense fallback={null}><HomeDesktop /></Suspense> : <BudgetMobile />;
}

function BudgetMobile() {
  const [month, setMonth] = useBudgetMonth();
  const { money } = useMoney();
  const { view, today, transactions, accounts, refreshDismissed, hasBudget, failed, retry } = useMonthData(month);
  const online = useOnline();
  const onDismiss = (key: string) => { dismissMatch(key); refreshDismissed(); };

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-5 animate-fade-up" data-testid="budget-home">
      <BudgetHeader title="Orçamento" subtitle={view?.when === "current" ? `${monthLabel(month)} · hoje é ${dm(today)}` : monthLabel(month)} month={month} setMonth={setMonth} />

      {!online && view ? <OfflineNote /> : null}
      {!view ? (failed ? <BudgetFailed onRetry={retry} /> : <BudgetLoading />) : (
        <div className="flex flex-col gap-5">
          {!hasBudget ? <NoBudgetCard compact /> : <NextStepCard />}
          <FreeCard v={view} money={money} />
          {view.when !== "past" ? (
            <section aria-label="O que importa agora">
              <h2 className={cn(h2, "mb-2.5")}>O que importa agora</h2>
              <HomeInsights v={view} money={money} onDismiss={onDismiss} transactions={transactions} accounts={accounts} />
            </section>
          ) : null}
          <section aria-label="Limites do mês" className={card}>
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className={h2}>Limites do mês</h2><Link to={`/orcamento/gastos?mes=${month}`} className="text-[13px] font-semibold text-primary">Ver todos</Link></div>
            <LimitsSummary v={view} money={money} />
          </section>
          <Shortcuts month={month} />
          {view.goals.length ? <GoalsCard v={view} money={money} /> : null}
          <RecentCard v={view} transactions={transactions} />
        </div>
      )}
    </div>
  );
}

type P = { v: MonthView; money: (v: number) => string };

/** The big number and, right under it, where the month is going. Everything else about it is in "Ver a conta". */
function FreeCard({ v, money }: P) {
  if (v.when === "past") {
    const left = v.earned - v.spent;
    return (
      <section aria-label="Resultado do mês" className={cn(card, "flex flex-col gap-2")}>
        <p className="text-xs font-semibold text-muted-foreground">Resultado de {monthLabel(v.month)}</p>
        <p className={cn("font-heading text-4xl font-bold tabular-nums", left < 0 && "text-expense")}>{money(left)}</p>
        <p className="text-sm text-muted-foreground">Entrou <strong className="text-income">{money(v.earned)}</strong> · saiu <strong className="text-foreground">{money(v.spent)}</strong></p>
        <Link to={`/orcamento/conta?mes=${v.month}`} className="text-sm font-semibold text-primary">Ver como o mês fechou</Link>
      </section>
    );
  }
  const future = v.when === "future";
  return (
    <section aria-label="Livre para gastar" className={cn(card, "flex flex-col gap-2")} data-testid="budget-free">
      <p className="text-xs font-semibold text-muted-foreground">{future ? `Livre estimado para ${monthLabel(v.month)}` : `Livre para gastar até ${v.daysInMonth}/${v.month.slice(5)}`}</p>
      <p className={cn("font-heading text-5xl font-bold tracking-tight tabular-nums", v.free < 0 && "text-expense")} data-testid="budget-free-value">{money(v.free)}</p>
      <p className="text-sm text-muted-foreground">
        {v.free <= 0 ? "O que falta pagar já passa do que está nas contas." : <>Cerca de <strong className="text-foreground">{money(v.perDay)} por dia</strong> {future ? `nos ${v.daysInMonth} dias do mês.` : `nos ${v.daysLeft} dias que faltam.`}</>}
        {!future ? <> No ritmo previsto, o mês termina com <strong className="text-foreground">{money(v.endBalance)}</strong> nas contas.</> : null}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <Link to={`/orcamento/compromissos?mes=${v.month}`} className="rounded-2xl bg-muted/60 px-3 py-2.5 hover:bg-muted" data-testid="budget-to-pay-link"><span className="block text-xs text-muted-foreground">Falta pagar</span><strong className="font-heading tabular-nums text-expense">− {money(v.toPay)}</strong></Link>
        <Link to={`/orcamento/conta?mes=${v.month}`} className="rounded-2xl bg-muted/60 px-3 py-2.5 hover:bg-muted" data-testid="budget-free-how"><span className="block text-xs text-muted-foreground">{v.toReceive > 0 ? "A receber" : "Nas contas hoje"}</span><strong className={cn("font-heading tabular-nums", v.toReceive > 0 && "text-income")}>{v.toReceive > 0 ? `+ ${money(v.toReceive)}` : money(v.inAccounts)}</strong></Link>
      </div>
      <Link to={`/orcamento/conta?mes=${v.month}`} className="inline-flex items-center gap-1 self-start text-sm font-semibold text-primary">Ver a conta do livre <ChevronRight className="h-4 w-4" /></Link>
    </section>
  );
}

function GoalsCard({ v, money }: P) {
  return (
    <section aria-label="Metas" className={card}>
      <div className="flex items-center justify-between"><h2 className={h2}>Metas</h2><Link to="/metas" className="text-[13px] font-semibold text-primary">Abrir Metas</Link></div>
      <ul className="mt-3 flex flex-col gap-3">
        {v.goals.slice(0, 3).map((g) => (
          <li key={g.id}><Link to={`/metas?meta=${g.id}`} className="block">
            <div className="flex justify-between gap-2 text-[13px]"><span className="truncate font-medium">{g.name}</span><span className="tabular-nums text-muted-foreground">{Math.round(g.percent * 100)}% · {money(g.saved)}</span></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(g.percent * 100)}%` }} /></div>
          </Link></li>
        ))}
      </ul>
    </section>
  );
}

/** The last records of the month (the full list is the Fluxo's). */
function RecentCard({ v, transactions }: { v: MonthView; transactions: Transaction[] }) {
  const list = [...transactions].sort((a, b) => b.date.localeCompare(a.date) || (b.created_at ?? "").localeCompare(a.created_at ?? "")).slice(0, 5);
  return (
    <section aria-label="Últimas transações" className="min-w-0" data-testid="budget-transactions">
      <div className="mb-2.5 flex items-center justify-between gap-2"><h2 className={h2}>Últimas transações</h2><Link to={`/transacoes?month=${v.month}`} className="text-[13px] font-semibold text-primary">Ver todas no Fluxo</Link></div>
      {list.length ? <TransactionList transactions={list} /> : <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">Nenhuma transação neste mês.</p>}
    </section>
  );
}
