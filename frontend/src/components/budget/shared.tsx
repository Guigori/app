/** Pieces shared by the Orçamento screens: data of a month, header with month and eye, and the area tabs. */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Settings2 } from "lucide-react";
import { fetchAccounts, fetchBalanceHistory, fetchBudget, fetchCalendar, fetchCards, fetchCurrentBudgetCycle, fetchFlow, fetchMe, fetchTransactions } from "@/lib/data";
import { listGoals } from "@/lib/goals";
import { addMonth, currentMonth, formatBRL, formatHiddenBRL, monthLabel, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { buildMonthView, type MonthView } from "@/lib/budget/monthView";
import { useBudgetSettings } from "@/lib/budget/prefs";
import { useBudgetPlans, useBudgetSpecials } from "@/components/budget/usePlans";
import { specialLimitsFor } from "@/lib/budget/specials";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const card = "rounded-[20px] border border-border bg-card p-5 min-w-0";
export const h2 = "font-heading text-base font-bold";
export const dm = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

/** The month shown, kept in the address (?mes=AAAA-MM) so every Orçamento screen opens on the same month. */
export function useBudgetMonth(fallback = currentMonth()): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("mes");
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : fallback;
  const set = (m: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("mes", m); return n; }, { replace: true });
  return [month, set];
}

export function useMoney() {
  const { hidden, toggle } = useBalanceHidden();
  return { hidden, toggle, money: (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v)) };
}

/** Everything a month of the Orçamento reads, from the device copy (few Firebase reads, works offline). */
export function useMonthData(month: string) {
  const today = todayISO();
  const [settings] = useBudgetSettings();
  const plans = useBudgetPlans();
  const review = plans.planOf(month);
  const specials = useBudgetSpecials();
  const included = review.specials ?? [];
  // Only the special plans the person included in this month count: none enters on its own.
  const specialLimits = useMemo(() => specialLimitsFor(month, specials.all.filter((s) => included.includes(s.id))), [month, specials.all, included.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const flow = useQuery({ queryKey: ["flow", "orcamento", month], queryFn: () => fetchFlow({ month, months: 2 }) });
  const calendar = useQuery({ queryKey: ["calendar", month, "todas"], queryFn: () => fetchCalendar(month) });
  const balance = useQuery({ queryKey: ["balance-history", month], queryFn: () => fetchBalanceHistory(month) });
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month) });
  const txs = useQuery({ queryKey: ["transactions", { month }], queryFn: () => fetchTransactions({ month }) });
  const cycle = useQuery({ queryKey: ["budget-v2-current"], queryFn: fetchCurrentBudgetCycle, retry: false });
  const goals = useQuery({ queryKey: ["goals", me.data?.id], queryFn: () => listGoals(me.data!.id), enabled: Boolean(me.data?.id) });

  const view = useMemo<MonthView | null>(() => {
    if (!accounts.data || !flow.data || !cards.data || !txs.data) return null;
    const c = cycle.data;
    const covers = c && c.start_date.slice(0, 7) <= month && c.end_date.slice(0, 7) >= month;
    return buildMonthView({
      month, today, accounts: accounts.data, cards: cards.data, flow: flow.data, calendar: calendar.data ?? null, balance: balance.data ?? null,
      budget: budget.data ?? null, cycleLimits: covers ? Object.fromEntries(c.allocations.map((a) => [a.category_id, a.planned])) : null,
      transactions: txs.data, goals: goals.data ?? [], cushion: settings.cushion, dismissedMatches: settings.dismissed,
      approved: review.approved, ignored: review.ignored, goalsReserve: review.planned_saving, alertsOn: settings.alerts, specialLimits,
    });
  }, [month, today, accounts.data, cards.data, flow.data, calendar.data, balance.data, budget.data, txs.data, cycle.data, goals.data, settings, review.approved, review.ignored, review.planned_saving, specialLimits]);

  const core = [accounts, flow, cards, txs];
  // A budget exists when there are limits (a cycle or category defaults) or a saved plan for the month.
  const hasBudget = !view || view.categories.length > 0 || Boolean(cycle.data) || Boolean(review.updated_at) || review.approved.length > 0;
  return {
    view, today, accounts: accounts.data ?? [], transactions: txs.data ?? [], goals: goals.data ?? [], hasBudget,
    failed: !view && core.some((q) => q.isError),
    retry: () => { for (const q of [...core, calendar, balance, budget, cycle]) void q.refetch(); },
    decide: (key: string, d: "approve" | "ignore" | "undo") => plans.decide(month, key, d),
    refreshDismissed: () => undefined,
  };
}

/** Online or not, following the browser (the data layer already falls back to the copy kept on this device). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  return online;
}

const AREAS = [
  { to: "/orcamento", label: "Visão geral" },
  { to: "/orcamento/gastos", label: "Gastos" },
  { to: "/orcamento/proximo", label: "Próximo mês" },
  { to: "/orcamento/projecao", label: "Projeção" },
  { to: "/orcamento/fechar", label: "Fechar o mês" },
  { to: "/orcamento/historico", label: "Histórico" },
] as const;

export function BudgetHeader({ title, subtitle, month, setMonth, monthSwitch = true }: {
  title: string; subtitle: string; month: string; setMonth?: (m: string) => void; monthSwitch?: boolean;
}) {
  const { hidden, toggle } = useBalanceHidden();
  const location = useLocation();
  const q = `?mes=${month}`;
  return (
    <div>
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {monthSwitch && setMonth ? (
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1" role="group" aria-label="Mês">
              <button type="button" onClick={() => setMonth(addMonth(month, -1))} aria-label="Mês anterior" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
              <strong className="min-w-[8.5rem] px-1 text-center text-sm" data-testid="budget-month">{monthLabel(month)}</strong>
              <button type="button" onClick={() => setMonth(addMonth(month, 1))} aria-label="Próximo mês" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
            </div>
          ) : null}
          <Link to="/orcamento/configuracoes" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full")} data-testid="budget-settings-button"><Settings2 className="h-4 w-4" /> Configurar</Link>
          <button type="button" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Esconder valores"} className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">{hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        </div>
      </header>
      <nav aria-label="Áreas do orçamento" className="mt-4 hidden gap-6 overflow-x-auto border-b border-border lg:flex">
        {AREAS.map((a) => {
          const on = location.pathname === a.to;
          const target = a.to === "/orcamento/proximo" && location.pathname !== a.to ? `?mes=${addMonth(month, 1)}` : q;
          return <Link key={a.to} to={`${a.to}${target}`} aria-current={on ? "page" : undefined} className={cn("whitespace-nowrap border-b-[3px] px-0.5 pb-2.5 pt-1 text-sm font-semibold", on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{a.label}</Link>;
        })}
      </nav>
    </div>
  );
}

export { todayISO };
