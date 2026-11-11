/** Orçamento and Metas in the library: the month's budget against what was spent, and the goals' progress. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchMe } from "@/lib/data";
import { listGoals } from "@/lib/goals";
import { addMonth, currentMonth, formatBRL, formatHiddenBRL, monthLabel, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { goalPlan, goalProgress } from "@/lib/goalProgress";
import { compare, expenseUntilDay, shortMonthName } from "@/lib/insights/compare";
import type { WidgetSize } from "@/lib/insights/registry";
import type { Finding } from "@/lib/insights/invoices";
import { cn } from "@/lib/utils";
import { BulletBar, FINNOS_COLOR, Gauge, SegmentedBar } from "@/components/charts/FinnosCharts";
import { FindingList, InsightShell, LABEL, NOTE, NUMBER_HERO, NUMBER_TILE, Tile } from "@/components/insights/InsightShell";
import { FinnSummary, VsLastMonth } from "@/components/insights/FinnSummary";
import { useAccounts, useBudget, useCalendar } from "@/components/insights/useInsightData";

type Props = { size: WidgetSize; to?: string; className?: string };
const Skeleton = ({ className }: { className?: string }) => <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
const useMoney = () => { const { hidden } = useBalanceHidden(); return { hidden, money: (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v)) }; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Orçamento: how much of the month's budget is used, which categories are over, and the pace against last month. */
export function BudgetInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const month = currentMonth();
  const prevMonth = addMonth(month, -1);
  const budget = useBudget(month);
  const calendar = useCalendar(month);
  const prevCalendar = useCalendar(prevMonth);
  if (!budget.data || !calendar.data) return <Skeleton className={className} />;
  const b = budget.data;
  if (b.planned <= 0) return (
    <Tile title="Orçamento" className={className} testId="budget-insight">
      <p className={NUMBER_TILE}>Sem limites</p>
      <p className={cn(NOTE, "mt-auto")}>Defina quanto quer gastar por categoria em Orçamento.</p>
    </Tile>
  );
  const day = Number(todayISO().slice(8, 10));
  const used = b.spent / b.planned;
  const over = b.rows.filter((r) => r.budget > 0 && r.spent > r.budget).sort((x, y) => y.spent - y.budget - (x.spent - x.budget));
  const close = b.rows.filter((r) => r.budget > 0 && r.spent <= r.budget && r.spent / r.budget >= 0.8);
  const rows = [...b.rows].filter((r) => r.budget > 0).sort((x, y) => y.spent / y.budget - x.spent / x.budget);
  const vs = compare(calendar.data ? expenseUntilDay(calendar.data.days, day) : b.spent, prevCalendar.data ? expenseUntilDay(prevCalendar.data.days, day) : null, "lower");
  const vsLine = <VsLastMonth c={vs} label={`gasto vs dia ${day} de ${shortMonthName(prevMonth)}`} format={money} />;
  if (size === "S") return (
    <Tile title="Orçamento" className={className} testId="budget-insight">
      <p className={cn(NUMBER_TILE, b.remaining < 0 && "text-expense")}>{money(Math.abs(b.remaining))}</p>
      <p className={cn(NOTE, "mt-auto")}>{b.remaining < 0 ? "acima do orçamento" : "sobram no mês"} · {Math.round(used * 100)}% usado</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title="Orçamento do mês" className={className} testId="budget-insight">
      <div className="flex min-h-0 flex-1 items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className={cn(NUMBER_TILE, b.remaining < 0 && "text-expense")}>{money(Math.abs(b.remaining))}</p>
          <p className={cn(NOTE, "mt-1")}>{b.remaining < 0 ? "acima" : "sobram"} de {money(b.planned)}</p>
          <div className="mt-1"><VsLastMonth c={vs} label={`vs ${shortMonthName(prevMonth)}`} format={money} /></div>
          {over.length ? <p className="mt-1 truncate text-[13px] font-semibold text-expense">{over.length} {over.length === 1 ? "categoria passou" : "categorias passaram"}</p> : null}
        </div>
        <Gauge percent={used} size={104} detail={<>{money(b.spent)}<br />de {money(b.planned)}</>}><span className="text-sm font-semibold tabular-nums">{Math.round(used * 100)}%</span></Gauge>
      </div>
    </Tile>
  );
  const findings: Finding[] = [];
  if (over.length) findings.push({ tone: "bad", text: `${over.map((r) => r.name).slice(0, 3).join(", ")} ${over.length === 1 ? "passou" : "passaram"} do limite: ${money(over.reduce((s, r) => s + r.spent - r.budget, 0))} acima.` });
  if (close.length) findings.push({ tone: "info", text: `${close.map((r) => r.name).slice(0, 3).join(", ")} ${close.length === 1 ? "está perto" : "estão perto"} do limite.` });
  if (!over.length && !close.length) findings.push({ tone: "good", text: "Todas as categorias estão dentro do limite." });
  const summary = [
    `Do orçamento de ${money(b.planned)} já foram ${money(b.spent)} (${Math.round(used * 100)}%); ${b.remaining >= 0 ? `sobram ${money(b.remaining)}` : `passou ${money(-b.remaining)}`}.`,
    findings[0].text,
    vs ? `Até hoje você gastou ${vs.same ? "o mesmo que" : vs.better ? `${money(-vs.delta)} a menos que` : `${money(vs.delta)} a mais que`} até o dia ${day} de ${shortMonthName(prevMonth)}.` : "",
  ].filter(Boolean);
  const list = size === "XL" ? rows : rows.slice(0, 4);
  return (
    <>{size === "XL" ? <FinnSummary title="Orçamento" sentences={summary} context={{ planejado: b.planned, gasto: b.spent, sobra: b.remaining, acima: over.map((r) => ({ categoria: r.name, gasto: r.spent, limite: r.budget })) }} /> : null}
    <InsightShell title="Orçamento do mês" subtitle={monthLabel(month)} to={to} className={className} testId="budget-insight">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className={LABEL}>{b.remaining < 0 ? "Acima do orçamento" : "Sobram"}</p>
          <p className={cn(NUMBER_HERO, "mt-2", b.remaining < 0 && "text-expense")}>{hidden ? "R$ ••••" : formatBRL(Math.abs(b.remaining))}</p>
          <p className={cn(NOTE, "mt-2")}>de {money(b.planned)} · {money(b.spent)} gastos</p>
          <div className="mt-1">{vsLine}</div>
        </div>
        <Gauge percent={used} size={112} detail={<>{money(b.spent)}<br />de {money(b.planned)}</>}><span className="text-sm font-semibold tabular-nums">{Math.round(used * 100)}%</span></Gauge>
      </div>
      <ul className="mt-5 space-y-3.5">
        {list.map((r) => (
          <li key={r.category_id}>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate font-medium">{r.name}</span><span className={cn("shrink-0 tabular-nums", r.spent > r.budget ? "font-semibold text-expense" : "text-muted-foreground")}>{money(r.spent)} <span className="text-muted-foreground">/ {money(r.budget)}</span></span></div>
            <BulletBar className="mt-2" value={r.spent} limit={r.budget} format={money} />
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-4"><FindingList findings={size === "XL" ? findings : findings.slice(0, 1)} /></div>
    </InsightShell></>
  );
}

/** Metas: each goal's progress, whether it is on pace, what it needs per month, and this month's saving against last month. */
export function GoalsInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const today = todayISO();
  const month = today.slice(0, 7);
  const prevMonth = addMonth(month, -1);
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60_000 });
  const goals = useQuery({ queryKey: ["goals", me.data?.id], queryFn: () => listGoals(me.data!.id), enabled: Boolean(me.data?.id), staleTime: 60_000 });
  const accounts = useAccounts();
  if (!goals.data || !accounts.data) return <Skeleton className={className} />;
  const rows = goals.data.map((g) => {
    const account = accounts.data.find((a) => a.id === g.account);
    const p = goalProgress(g, account ? account.balance : null, today);
    return { g, p, plan: goalPlan(g, p.saved, today) };
  }).sort((x, y) => Number(x.p.status === "concluida") - Number(y.p.status === "concluida") || y.p.percent - x.p.percent);
  if (!rows.length) return (
    <Tile title="Metas" className={className} testId="goals-insight">
      <p className={NUMBER_TILE}>Nenhuma meta</p>
      <p className={cn(NOTE, "mt-auto")}>Crie uma meta em Patrimônio para acompanhar aqui.</p>
    </Tile>
  );
  // Money put into goals this month and last month (contributions minus withdrawals).
  const moved = (m: string) => goals.data.flatMap((g) => g.deposits ?? []).filter((d) => d.date.slice(0, 7) === m).reduce((s, d) => s + (d.kind === "retirada" ? -d.value : d.value), 0);
  const vs = compare(moved(month), moved(prevMonth), "higher");
  const vsLine = <VsLastMonth c={vs} label={`guardado vs ${shortMonthName(prevMonth)}`} format={money} />;
  const saved = rows.reduce((s, r) => s + r.p.saved, 0), target = rows.reduce((s, r) => s + r.g.target, 0);
  const late = rows.filter((r) => r.p.status === "atrasada");
  const bar = (r: (typeof rows)[number]) => <SegmentedBar segments={[{ value: r.p.saved, color: r.p.status === "atrasada" ? FINNOS_COLOR.expense : FINNOS_COLOR.result, label: "Guardado" }]} total={r.g.target} height={8} format={money} />;
  const first = rows[0];
  if (size === "S") return (
    <Tile title={first.g.name} className={className} testId="goals-insight">
      <p className={NUMBER_TILE}>{Math.round(first.p.percent)}%</p>
      <div className="mt-2">{bar(first)}</div>
      <p className={cn(NOTE, "mt-auto")}>faltam {money(first.plan.remaining)}</p>
    </Tile>
  );
  const row = (r: (typeof rows)[number], detail: boolean, compact = false) => (
    <li key={r.g.id}>
      <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium">{r.g.name}</span><span className="shrink-0 text-sm font-semibold tabular-nums">{Math.round(r.p.percent)}%</span></div>
      <div className="mt-1.5">{bar(r)}</div>
      <p className={cn("mt-1.5 text-[12px]", !detail && "truncate", r.p.status === "atrasada" ? "font-semibold text-expense" : "text-muted-foreground")}>
        {money(r.p.saved)} de {money(r.g.target)}
        {r.p.status === "concluida" ? " · concluída" : r.p.status === "atrasada" ? (compact ? " · atrasada" : ` · ${money(r.p.behindBy)} atrás do plano`) : " · no ritmo"}
        {detail && r.plan.neededPerMonth ? ` · ${money(r.plan.neededPerMonth)}/mês até ${monthLabel(r.plan.deadline ?? month).toLowerCase()}` : ""}
      </p>
    </li>
  );
  if (size === "M") return (
    <Tile title="Metas" className={className} testId="goals-insight">
      <ul className="space-y-2.5">{rows.slice(0, 2).map((r) => row(r, false, true))}</ul>
      <div className="mt-auto">{vsLine}</div>
    </Tile>
  );
  const summary = [
    `Nas suas ${rows.length} ${rows.length === 1 ? "meta" : "metas"} já estão ${money(saved)} de ${money(target)} (${Math.round((saved / Math.max(target, 0.01)) * 100)}%).`,
    late.length ? `${late.map((r) => r.g.name).join(", ")} ${late.length === 1 ? "está atrasada" : "estão atrasadas"}: ${money(late.reduce((s, r) => s + r.p.behindBy, 0))} atrás do plano.` : "Todas as metas estão no ritmo do plano.",
    vs ? `Neste mês você guardou ${money(moved(month))}, ${vs.same ? "o mesmo que" : vs.better ? `${money(vs.delta)} a mais que` : `${money(-vs.delta)} a menos que`} em ${shortMonthName(prevMonth)}.` : "",
  ].filter(Boolean);
  return (
    <>{size === "XL" ? <FinnSummary title="Metas" sentences={summary} context={{ metas: rows.map((r) => ({ nome: r.g.name, guardado: r.p.saved, alvo: r.g.target, status: r.p.status, por_mes: r.plan.neededPerMonth })) }} /> : null}
    <InsightShell title="Metas" subtitle={`${money(saved)} de ${money(target)} guardados`} to={to} className={className} testId="goals-insight">
      <div className="flex items-end justify-between gap-4">
        <div><p className={LABEL}>Guardado neste mês</p><p className={cn(NUMBER_HERO, "mt-2")}>{hidden ? "R$ ••••" : formatBRL(moved(month))}</p><div className="mt-1">{vsLine}</div></div>
      </div>
      <ul className="mt-5 space-y-4">{(size === "XL" ? rows : rows.slice(0, 3)).map((r) => row(r, size === "XL"))}</ul>
      {size === "XL" ? <Link to="/patrimonio" className="mt-5 text-sm font-semibold text-primary">{cap("abrir metas em Patrimônio")}</Link> : null}
    </InsightShell></>
  );
}
