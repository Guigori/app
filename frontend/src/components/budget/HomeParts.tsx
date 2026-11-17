/** Peças do início do Orçamento (celular e computador): o que importa agora, limites em resumo e atalhos. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Bell, Check, BarChart3, CalendarPlus, CalendarRange, CheckCircle2, ClipboardCheck, Info, Layers, ListChecks, MoreHorizontal, Plane, Settings2, TrendingUp, Wallet } from "lucide-react";
import type { MonthView } from "@/lib/budget/monthView";
import { buildHomeInsights, dueReminders, type InsightTone } from "@/lib/budget/homeInsights";
import { useBudgetPlans } from "@/components/budget/usePlans";
import { useBudgetSettings } from "@/lib/budget/prefs";
import { addMonth, monthLabel } from "@/lib/format";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BulletBar } from "@/components/charts/FinnosCharts";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Account, Transaction } from "@/types/finnos";
import { buildSpendingView } from "@/lib/budget/spending";

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const TONE: Record<InsightTone, { icon: typeof Info; cls: string }> = {
  expense: { icon: AlertTriangle, cls: "text-expense" },
  warn: { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, cls: "text-primary" },
  good: { icon: CheckCircle2, cls: "text-income" },
};

/** "Para confirmar": a record that looks like an open estimate. The estimate is resolved in Fluxo. */
function MatchItem({ v, money, onDismiss, transactions }: { v: MonthView; money: (n: number) => string; onDismiss: (k: string) => void; transactions: Transaction[] }) {
  const { openTransactionDetail } = useDialogs();
  const m = v.match!;
  const estimate = transactions.find((t) => t.id === m.estimate.transaction_id) ?? null;
  return (
    <li className="rounded-2xl bg-primary/[0.06] p-3.5 text-[13px]" data-testid="budget-match">
      <p className="font-semibold">Para confirmar</p>
      <p className="mt-0.5">Saiu {money(m.realized.value)} “{m.realized.name}” em {dm(m.realized.date)}. É {m.estimate.type === "receita" ? "a entrada" : "a conta"} <strong>{m.estimate.name}</strong> (estimada em {money(m.estimate.value)})?</p>
      <div className="mt-2 flex gap-1.5">
        <button type="button" disabled={!estimate} onClick={() => estimate && openTransactionDetail(estimate)} className={cn(buttonVariants({ size: "sm" }), "h-8 rounded-full")}>Sim, abrir a estimativa</button>
        <button type="button" onClick={() => onDismiss(`${m.realized.id}|${m.estimate.key}`)} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-8 rounded-full")}>Não é</button>
      </div>
    </li>
  );
}

export function HomeInsights({ v, money, onDismiss, transactions, accounts, max = 4 }: { v: MonthView; money: (n: number) => string; onDismiss: (k: string) => void; transactions: Transaction[]; accounts: Account[]; max?: number }) {
  const [settings] = useBudgetSettings();
  const [all, setAll] = useState(false);
  // The same pace as Gastos do mês: fixed bills already paid are not projected over the remaining days.
  const pace = useMemo(() => v.when === "current" ? Object.fromEntries(buildSpendingView({ month: v.month, today: v.today, categories: v.categories, transactions, accounts, monthExpense: v.spent }).categories.map((c) => [c.category_id, c.projected])) : undefined, [v, transactions, accounts]);
  const items = buildHomeInsights(v, money, settings.alerts, pace);
  // Reminders the person set for the month (when planning or closing), on their day.
  const plans = useBudgetPlans();
  const plan = plans.planOf(v.month);
  const due = v.when === "current" ? dueReminders(plan.reminders ?? [], v.today) : [];
  const markDone = (id: string) => plans.save.mutate({ ...plan, reminders: (plan.reminders ?? []).map((r) => (r.id === id ? { ...r, done: true } : r)) });
  if (!items.length && !v.match && !due.length) return null;
  const shown = all ? items : items.slice(0, max);
  return (
    <div data-testid="budget-alerts">
      <ul className="flex flex-col gap-2">
        {due.map((r) => {
          const d = Math.round((Date.parse(`${r.date}T12:00:00`) - Date.parse(`${v.today}T12:00:00`)) / 86400000);
          return (
            <li key={r.id} className="flex gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/10" data-testid="insight-lembrete">
              <Bell className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{r.text}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Lembrete · {d === 0 ? "hoje" : d === 1 ? "amanhã" : d < 0 ? `era em ${dm(r.date)}` : dm(r.date)}</p>
                <button type="button" onClick={() => markDone(r.id)} className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-primary"><Check className="h-3.5 w-3.5" /> Feito</button>
              </div>
            </li>
          );
        })}
        {v.match ? <MatchItem v={v} money={money} onDismiss={onDismiss} transactions={transactions} /> : null}
        {shown.map((i) => {
          const T = TONE[i.tone];
          return (
            <li key={i.id} className="flex gap-3 rounded-2xl border border-border bg-card p-3.5" data-testid={`insight-${i.id}`}>
              <T.icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", T.cls)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{i.title}</p>
                {i.text ? <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{i.text}</p> : null}
                {i.action ? <Link to={i.action.to} className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-primary">{i.action.label} <ArrowRight className="h-3.5 w-3.5" /></Link> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > max ? <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-[13px] font-semibold text-primary">{all ? "Mostrar menos" : `Ver mais ${items.length - max}`}</button> : null}
    </div>
  );
}

/** Limits in one card: the day-to-day total against the month, and the categories that need attention first. */
export function LimitsSummary({ v, money, top = 4, total = true }: { v: MonthView; money: (n: number) => string; top?: number; total?: boolean }) {
  const d = v.daily;
  if (!d.limit) return <p className="text-sm text-muted-foreground">Sem limites por categoria. <Link to="/orcamento/configuracoes" className="font-semibold text-primary">Definir limites</Link></p>;
  // Most at risk first: over the limit, then the highest use.
  const cats = [...v.categories].filter((c) => c.spent > 0 || top >= v.categories.length).sort((a, b) => b.over - a.over || b.spent / b.limit - a.spent / a.limit).slice(0, top);
  const ahead = v.when === "current" && d.percent > d.elapsed + 0.05;
  return (
    <div>
      {total ? <>
      <div className="flex items-baseline justify-between gap-2 text-sm"><span><strong className="tabular-nums">{money(d.spent)}</strong><span className="text-muted-foreground"> de {money(d.limit)}</span></span><span className={cn("text-xs font-semibold", d.spent > d.limit ? "text-expense" : ahead ? "text-amber-700 dark:text-amber-400" : "text-income")}>{d.spent > d.limit ? "passou" : `${Math.round(d.percent * 100)}% usado`}</span></div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={cn("block h-full rounded-full", d.spent > d.limit ? "bg-expense" : ahead ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.min(100, d.percent * 100)}%` }} />
        {v.when === "current" ? <span className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${d.elapsed * 100}%` }} /> : null}
      </div>
      {v.when === "current" ? <p className="mt-1.5 text-xs text-muted-foreground">{Math.round(d.elapsed * 100)}% do mês passou (o traço). {d.spent > d.limit ? "Os limites já passaram." : `Até ${money(d.allowance)} por dia mantém tudo dentro.`}</p> : null}
      </> : null}
      <ul className={cn("flex flex-col gap-3", total && "mt-3.5")}>
        {cats.map((c) => (
          <li key={c.category_id} data-testid="budget-category">
            <Link to={`/orcamento/gastos?mes=${v.month}&categoria=${c.category_id}`} className="block rounded-lg hover:bg-muted/40">
            <div className="flex justify-between gap-3 text-[13px]"><span className="truncate font-medium">{c.name}</span><span className={cn("tabular-nums", c.over > 0 ? "font-semibold text-expense" : "text-muted-foreground")}>{money(c.spent)} de {money(c.limit)}</span></div>
            <BulletBar className="mt-1.5" value={c.spent} limit={c.limit} striped={c.benefit} stripedLabel="com VR/VA" format={money} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The main places in four buttons; the rest under "Mais". */
export function Shortcuts({ month, columns = 4 }: { month: string; columns?: 2 | 4 }) {
  const [more, setMore] = useState(false);
  const prev = addMonth(month, -1), next = addMonth(month, 1);
  const short = (m: string) => monthLabel(m).split(" ")[0].toLowerCase();
  const main = [
    { to: `/orcamento/compromissos?mes=${month}`, label: "Compromissos", icon: ListChecks, id: "compromissos" },
    { to: `/orcamento/proximo?mes=${next}`, label: `Planejar ${short(next)}`, icon: CalendarRange, id: "proximo" },
    { to: `/orcamento/fechar?mes=${prev}`, label: `Fechar ${short(prev)}`, icon: ClipboardCheck, id: "fechar" },
    { to: `/orcamento/gastos?mes=${month}`, label: "Gastos do mês", icon: Wallet, id: "gastos" },
  ];
  const rest = [
    { to: `/orcamento/projecao?mes=${next}`, label: "Projeção", icon: TrendingUp, id: "projecao" },
    { to: "/orcamento/especiais", label: "Planos especiais", icon: Plane, id: "especiais" },
    { to: `/orcamento/novo?mes=${next}`, label: "Criar novo período", icon: CalendarPlus, id: "novo" },
    { to: `/orcamento/historico?mes=${prev}`, label: "Histórico", icon: BarChart3, id: "historico" },
    { to: "/orcamento/configuracoes", label: "Configurar", icon: Settings2, id: "configurar" },
    { to: "/orcamento/ciclos", label: "Ciclos", icon: Layers, id: "ciclos" },
  ];
  const tile = "flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-card px-2 py-3 text-center text-xs font-semibold hover:bg-muted/50";
  return (
    <nav aria-label="Atalhos do orçamento">
      <div className={cn("grid gap-2", columns === 4 ? "grid-cols-4" : "grid-cols-2")}>
        {main.map((l) => <Link key={l.id} to={l.to} className={tile} data-testid={`budget-link-${l.id}`}><l.icon className="h-5 w-5 text-primary" />{l.label}</Link>)}
      </div>
      <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary"><MoreHorizontal className="h-4 w-4" /> {more ? "Menos" : "Mais"}</button>
      {more ? <div className="mt-2 grid grid-cols-2 gap-1.5">{rest.map((l) => <Link key={l.id} to={l.to} className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-medium hover:bg-muted" data-testid={`budget-link-${l.id}`}><l.icon className="h-4 w-4 text-primary" />{l.label}</Link>)}</div> : null}
    </nav>
  );
}
