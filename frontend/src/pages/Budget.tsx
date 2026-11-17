/**
 * Orçamento · início (tela 1 do protótipo aprovado). Shows the month at a glance; everything shown comes from its own
 * module (Carteira, Fluxo, Assinaturas, Metas) through the device copy. The screen never writes: actions open the record
 * where it lives.
 */
import { Suspense } from "react";
import { lazyRetry } from "@/lib/lazyRetry";
import { useIsDesktop } from "@/components/budget/desktop/kit";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import { addMonth, monthLabel } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { useBudgetClosings } from "@/components/budget/usePlans";
import type { MonthView } from "@/lib/budget/monthView";
import { dismissMatch } from "@/lib/budget/prefs";
import { TransactionList } from "@/components/transactions/TransactionList";
import { card, dm, h2, useBudgetMonth, useMoney, useMonthData, useOnline } from "@/components/budget/shared";
import { BudgetFailed, BudgetLoading, NoBudgetCard, OfflineNote } from "@/components/budget/States";
import { HomeInsights, LimitsSummary } from "@/components/budget/HomeParts";
import { BalanceCard, BillsCard, DistributionCard, PaceCard, lbl } from "@/components/budget/HomeCharts";
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
      <HomeHeader month={month} setMonth={setMonth} today={today} v={view} />

      {!online && view ? <OfflineNote /> : null}
      {!view ? (failed ? <BudgetFailed onRetry={retry} /> : <BudgetLoading />) : (
        <div className="flex flex-col gap-4">
          {!hasBudget ? <NoBudgetCard compact /> : null}
          <FreeCard v={view} money={money} />
          {view.when !== "past" ? <HomeInsights v={view} money={money} onDismiss={onDismiss} transactions={transactions} accounts={accounts} variant="list" /> : null}
          <DistributionCard v={view} money={money} />
          <BalanceCard v={view} money={money} />
          <PaceCard v={view} money={money} />
          <section aria-label="Por categoria" className={card}>
            <div className="mb-3 flex items-baseline justify-between gap-2"><p className={lbl}>Por categoria</p><Link to={`/orcamento/gastos?mes=${month}`} className="text-xs font-semibold text-primary">ver gastos ›</Link></div>
            <LimitsSummary v={view} money={money} top={view.categories.length} total={false} />
            {view.categories.length ? <p className="mt-3 text-[11px] text-muted-foreground">A marca é o limite; o que passa dele fica vermelho. Listrado: pago com vale, conta no limite.</p> : null}
          </section>
          <BillsCard v={view} money={money} kind="despesa" />
          <BillsCard v={view} money={money} kind="receita" max={4} />
          {view.goals.length ? <GoalsCard v={view} money={money} /> : null}
          <PlanLinks month={month} />
          <RecentCard v={view} transactions={transactions} />
        </div>
      )}
    </div>
  );
}

/** Título com Histórico, Configurar e o olho; abaixo, o mês com setas grandes e onde se está nele. */
function HomeHeader({ month, setMonth, today, v }: { month: string; setMonth: (m: string) => void; today: string; v: MonthView | null }) {
  const { hidden, toggle } = useBalanceHidden();
  const pill = "grid h-9 place-items-center rounded-full border border-border bg-card px-3 text-xs font-bold";
  const arrow = "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card";
  const left = v ? v.daysInMonth - Number(today.slice(8, 10)) : 0;
  const note = !v ? "" : v.when === "current" ? `Hoje, ${dm(today)} · ${left ? `faltam ${left} ${left === 1 ? "dia" : "dias"}` : "último dia"}` : v.when === "past" ? "Mês passado" : "Previsão";
  return (
    <div>
      <header className="flex items-center gap-2">
        <h1 className="flex-1 font-heading text-2xl font-bold tracking-tight">Orçamento</h1>
        <Link to={`/orcamento/historico?mes=${addMonth(month, -1)}`} className={pill}>Histórico</Link>
        <Link to="/orcamento/configuracoes" className={pill} data-testid="budget-settings-button">Configurar</Link>
        <button type="button" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Esconder valores"} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card">{hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
      </header>
      <div className="mt-3 flex items-center gap-2" role="group" aria-label="Mês">
        <button type="button" onClick={() => setMonth(addMonth(month, -1))} aria-label="Mês anterior" className={arrow}><ChevronLeft className="h-5 w-5" /></button>
        <div className="flex-1 text-center"><strong className="block font-heading text-base" data-testid="budget-month">{monthLabel(month).replace(" de ", " ")}</strong><span className="text-xs text-muted-foreground">{note}</span></div>
        <button type="button" onClick={() => setMonth(addMonth(month, 1))} aria-label="Próximo mês" className={arrow}><ChevronRight className="h-5 w-5" /></button>
      </div>
    </div>
  );
}

type P = { v: MonthView; money: (n: number) => string };

/** O número grande, sem moldura: quanto está livre, o estado do mês, o porquê e o passo do ritual. */
function FreeCard({ v, money }: P) {
  const past = v.when === "past", future = v.when === "future";
  const value = past ? v.earned - v.spent : v.free;
  const ahead = v.when === "current" && v.daily.limit > 0 && v.daily.percent > v.daily.elapsed + 0.05;
  const state: "green" | "orange" | "red" = value < 0 ? "red" : !past && ahead ? "orange" : "green";
  const TONE = { green: ["bg-income/10 text-income", "text-income"], orange: ["bg-amber-500/10 text-amber-700 dark:text-amber-400", "text-amber-700 dark:text-amber-400"], red: ["bg-expense/10 text-expense", "text-expense"] } as const;
  const end = `${v.daysInMonth}/${v.month.slice(5)}`;
  const status = past ? (value < 0 ? "Faltou" : "Fechado") : value < 0 ? "Economize" : state === "orange" ? "Atenção" : future ? "Previsão" : "Pode gastar";
  const label = past ? (value < 0 ? "Faltou no mês" : "Sobrou no mês") : value < 0 ? `Faltando até ${end}` : future ? "Livre previsto" : `Livre até ${end}`;
  const note = past
    ? <>Entrou {money(v.earned)} e saiu {money(v.spent)}.</>
    : value < 0
      ? <>Não dá para pagar tudo{v.cushion ? " e manter a reserva" : ""}. Corte {money(-value)} no mês{v.cushion ? " ou use parte da reserva" : ""}.</>
      : <>{money(v.perDay)} por dia, já pagando o que vence{v.cushion ? " e guardando a reserva" : ""}.{v.toReceive > 0 && v.projectedFree > v.free ? <> {money(v.projectedFree)} se o que falta receber cair.</> : null}</>;
  return (
    <section aria-label={label} className="px-2" data-testid="budget-free">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", TONE[state][0])}>{status}</span>
      </div>
      <p className={cn("mt-1.5 font-heading text-5xl font-bold tracking-tight tabular-nums", TONE[state][1])} data-testid="budget-free-value">{value < 0 ? "− " : ""}{money(Math.abs(value))}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{note}</p>
      <Link to={`/orcamento/conta?mes=${v.month}`} className="mt-2 inline-block text-[13px] font-bold text-primary" data-testid="budget-free-how">Como chegamos a esse valor</Link>
      <Ritual v={v} />
    </section>
  );
}

/** O passo do ritual do mês, logo abaixo do número: fechar o anterior, planejar o próximo ou rever o fechamento. */
function Ritual({ v }: { v: MonthView }) {
  const closings = useBudgetClosings();
  const prev = addMonth(v.month, -1), next = addMonth(v.month, 1);
  const name = (m: string) => monthLabel(m).split(" ")[0].toLowerCase();
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const r = v.when === "past"
    ? { title: `Rever o fechamento de ${name(v.month)}`, text: "Abra para ver o retrato do mês.", to: `/orcamento/historico?mes=${v.month}` }
    : v.when === "future"
      ? { title: `Planejar ${name(v.month)}`, text: "Ajustar limites, metas e o que vai entrar.", to: `/orcamento/novo?mes=${v.month}` }
      : closings.closingOf(prev)
        ? { title: `Planejar ${name(next)}`, text: `${cap(name(prev))} já está fechado. Faça a conta do mês que vem.`, to: `/orcamento/proximo?mes=${next}` }
        : { title: "Sentar e organizar o mês", text: `Fechar ${name(prev)}, resolver o que ficou e fazer a conta de ${name(next)}.`, to: `/orcamento/fechar?mes=${prev}` };
  return (
    <Link to={r.to} className="mt-3.5 flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-[13px]" data-testid="budget-ritual">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <span className="min-w-0 flex-1"><strong>{r.title}</strong> <span className="text-muted-foreground">· {r.text}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
    </Link>
  );
}

function GoalsCard({ v, money }: P) {
  return (
    <section aria-label="Metas">
      <div className="mb-2.5 flex items-baseline justify-between gap-2"><h2 className="font-heading text-[17px] font-bold">Metas</h2><Link to="/metas" className="text-xs font-semibold text-primary">Abrir Metas</Link></div>
      <ul className="flex flex-col gap-2">
        {v.goals.slice(0, 4).map((g) => (
          <li key={g.id}><Link to={`/metas?meta=${g.id}`} className="block rounded-[20px] border border-border bg-card p-3.5">
            <div className="flex justify-between gap-2 text-sm"><strong className="truncate">{g.name}</strong><span className="shrink-0 tabular-nums text-muted-foreground">{money(g.saved)} de {money(g.target)}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-income" style={{ width: `${Math.min(100, Math.round(g.percent * 100))}%` }} /></div>
            <span className={cn("mt-2 block text-xs", g.percent >= 1 ? "text-income" : "text-muted-foreground")}>{g.percent >= 1 ? "Meta alcançada" : `Faltam ${money(Math.max(0, g.target - g.saved))} · ${Math.round(g.percent * 100)}%`}</span>
          </Link></li>
        ))}
      </ul>
    </section>
  );
}

/** Planejar: as outras telas do Orçamento numa lista, como no protótipo. */
function PlanLinks({ month }: { month: string }) {
  const prev = addMonth(month, -1), next = addMonth(month, 1);
  const name = (m: string) => monthLabel(m).split(" ")[0];
  const links = [
    { to: `/orcamento/proximo?mes=${next}`, title: "Próximo mês", sub: `${name(next)}: o que vai entrar, sair e sobrar`, dot: "bg-primary", id: "proximo" },
    { to: `/orcamento/projecao?mes=${next}`, title: "Próximos meses", sub: "Projeção com os seus registros", dot: "bg-expense", id: "projecao" },
    { to: `/orcamento/compromissos?mes=${month}`, title: "Compromissos", sub: "Contas, faturas, parcelas e agendados", dot: "bg-muted-foreground/50", id: "compromissos" },
    { to: `/orcamento/gastos?mes=${month}`, title: "Gastos do mês", sub: "Para onde vai o dinheiro, por categoria", dot: "bg-amber-500", id: "gastos" },
    { to: "/orcamento/especiais", title: "Planos especiais", sub: "Viagens, festas e datas que pedem um plano", dot: "bg-[#B3A6FF]", id: "especiais" },
    { to: `/orcamento/fechar?mes=${prev}`, title: `Fechar ${name(prev).toLowerCase()}`, sub: "Conferir o mês e guardar o retrato", dot: "bg-amber-500", id: "fechar" },
    { to: `/orcamento/novo?mes=${next}`, title: "Criar novo período", sub: "Regra, ciclo e estimativas", dot: "bg-income", id: "novo" },
    { to: `/orcamento/historico?mes=${prev}`, title: "Histórico e análises", sub: "Fechamentos, retrospectiva e comparações", dot: "bg-amber-500", id: "historico" },
    { to: "/orcamento/ciclos", title: "Ciclos", sub: "Ciclo atual, próximo e fechados", dot: "bg-muted-foreground/50", id: "ciclos" },
  ];
  return (
    <section aria-label="Planejar">
      <h2 className="mb-2.5 font-heading text-[17px] font-bold">Planejar</h2>
      <nav aria-label="Planejar" className="overflow-hidden rounded-[20px] border border-border bg-card">
        {links.map((l) => (
          <Link key={l.id} to={l.to} className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0 hover:bg-muted/40" data-testid={`budget-link-${l.id}`}>
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", l.dot)} />
            <span className="min-w-0 flex-1"><strong className="block text-sm">{l.title}</strong><span className="text-xs text-muted-foreground">{l.sub}</span></span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </nav>
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
