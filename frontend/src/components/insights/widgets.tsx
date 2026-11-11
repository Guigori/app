/** Draws any analysis of the library in a given size; the board and the gallery use this one entry point. */
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard, fetchRadar } from "@/lib/data";
import { addMonth, currentMonth, formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { needsAttention, radarTarget, sortSignals } from "@/lib/radarUi";
import { cn } from "@/lib/utils";
import { InsightShell, NOTE, NUMBER_TILE, Tile } from "@/components/insights/InsightShell";
import { monthRange } from "@/lib/insights/fixedBills";
import { detailPath, insightById, type WidgetConfig, type WidgetSize } from "@/lib/insights/registry";
import { ExpensesDonutChart } from "@/components/dashboard/ExpensesDonutChart";
import { RadarSection } from "@/components/dashboard/RadarSection";
import { FixedBillsInsight } from "@/components/insights/FixedBillsInsight";
import { InstallmentsInsight } from "@/components/insights/InstallmentsInsight";
import { InvoicesInsight } from "@/components/insights/InvoicesInsight";
import { BalanceForecastInsight, NextInvoiceInsight, SpendTodayInsight, WeekAheadInsight } from "@/components/insights/StarInsights";
import { BudgetInsight, GoalsInsight } from "@/components/insights/PlanInsights";
import { useCalendar, useCards } from "@/components/insights/useInsightData";
import { Donut } from "@/components/charts/FinnosCharts";
import { FinnSummary, VsLastMonth } from "@/components/insights/FinnSummary";
import { compare, expenseUntilDay, shortMonthName } from "@/lib/insights/compare";

/** A screen can draw one analysis its own way (Início keeps its interactive donut). */
export type WidgetSlots = Partial<Record<string, (size: WidgetSize) => ReactNode>>;

/** Gastos por categoria: S the category that weighs most, M a small donut with the top three, L donut + list, XL the full chart. */
function CategoriesWidget({ size, to, className }: { size: WidgetSize; to?: string; className?: string }) {
  const navigate = useNavigate();
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const month = currentMonth();
  const dashboard = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month), staleTime: 60_000 });
  const [picked, setPicked] = useState<string | null>(null);
  const prevMonth = addMonth(month, -1);
  const calendar = useCalendar(month);
  const prevCalendar = useCalendar(prevMonth);
  if (!dashboard.data) return <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
  const slices = dashboard.data.categories;
  const total = dashboard.data.expense;
  const open = (id: string | null | undefined) => navigate(`/transacoes?month=${month}&metric=despesas&category_id=${encodeURIComponent(id ?? "")}`);
  const day = Number(todayISO().slice(8, 10));
  const vs = calendar.data && prevCalendar.data ? compare(expenseUntilDay(calendar.data.days, day), expenseUntilDay(prevCalendar.data.days, day), "lower") : null;
  const vsLine = <VsLastMonth c={vs} label={`vs dia ${day} de ${shortMonthName(prevMonth)}`} format={money} />;
  if (size === "XL") {
    const top3 = slices.slice(0, 3);
    const summary = [
      slices[0] ? `${slices[0].name} é onde mais foi dinheiro: ${money(slices[0].total)}, ${Math.round(slices[0].percent)}% dos ${money(total)} gastos no mês.` : "Ainda não há gastos neste mês.",
      top3.length > 1 ? `Junto com ${top3.slice(1).map((s) => s.name).join(" e ")}, as três maiores somam ${Math.round(top3.reduce((a, s) => a + s.percent, 0))}% do total.` : "",
      vs ? `Até hoje você gastou ${vs.same ? "o mesmo que" : vs.better ? `${money(-vs.delta)} a menos que` : `${money(vs.delta)} a mais que`} até o dia ${day} de ${shortMonthName(prevMonth)}.` : "",
    ].filter(Boolean);
    return (
      <>
        <FinnSummary title="Gastos por categoria" sentences={summary} context={{ total, categorias: slices.map((s) => ({ nome: s.name, valor: s.total, pct: Math.round(s.percent) })) }} />
        <ExpensesDonutChart className={className} month={dashboard.data.month} slices={slices} total={total} selectedCategoryId={picked} onSelectCategory={(slice) => setPicked(slice?.category_id ?? null)} onOpenCategory={(slice) => open(slice.category_id)} />
      </>
    );
  }
  const top = slices[0];
  if (!top) return <Tile title="Gastos por categoria" className={className}><p className={NOTE}>Nenhuma despesa no mês.</p></Tile>;
  // Donut FINNOS (composição): the same interactive chart as Pra onde foi o dinheiro — tap a slice to focus it, again to go back.
  const donutSlices = slices.map((s) => ({ id: s.category_id ?? s.name, name: s.name, value: s.total, color: s.color }));
  const focus = slices.find((s) => (s.category_id ?? s.name) === picked) ?? null;
  const donut = (px: number) => <Donut slices={donutSlices} size={px} selectedId={picked} onSelect={setPicked} centerLabel="Gasto no mês" format={money} />;
  const list = (n: number) => (
    <ul className="min-w-0 flex-1 space-y-1">
      {(focus ? [focus] : slices.slice(0, n)).map((s) => {
        const id = s.category_id ?? s.name;
        return (
          <li key={id}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setPicked(picked === id ? null : id); }} className="block w-full rounded-lg px-1 py-1 text-left text-[13px] transition-colors active:bg-muted/60">
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} /><span className="truncate">{s.name}</span></span>
                <b className="shrink-0 font-semibold tabular-nums">{Math.round(s.percent)}%</b>
              </span>
              {n > 3 || focus ? <span className="block pl-4 text-[12px] tabular-nums text-muted-foreground">{money(s.total)}</span> : null}
            </button>
          </li>
        );
      })}
      {focus ? (
        <li className="flex flex-wrap gap-x-3 px-1 pt-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); open(focus.category_id); }} className="text-[12px] font-semibold text-primary">Ver {focus.name}</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setPicked(null); }} className="text-[12px] font-semibold text-muted-foreground">Ver todas</button>
        </li>
      ) : null}
    </ul>
  );
  if (size === "S") return (
    <Tile title="Mais pesou no mês" className={className} testId="categories-insight">
      <p className={cn(NUMBER_TILE, "truncate")}>{top.name}</p>
      <p className={cn(NOTE, "mt-auto")}>{Math.round(top.percent)}% · {money(top.total)}</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title="Gastos por categoria" className={className} testId="categories-insight">
      <div className="flex min-h-0 flex-1 items-center gap-4">{donut(92)}{list(3)}</div>
    </Tile>
  );
  return (
    <InsightShell title="Gastos por categoria" subtitle={`${money(total)} no mês · ${slices.length} ${slices.length === 1 ? "categoria" : "categorias"}`} to={to} className={className} testId="categories-insight">
      <div className="-mt-1 mb-3">{vsLine}</div>
      <div className="flex items-center gap-5">{donut(148)}{list(5)}</div>
    </InsightShell>
  );
}

/** Radar: S how many ask for attention, M the summary, L the top signals (each opens where it points). */
function RadarWidget({ size, to, className }: { size: WidgetSize; to?: string; className?: string }) {
  const navigate = useNavigate();
  const radar = useQuery({ queryKey: ["radar", currentMonth()], queryFn: fetchRadar, staleTime: 60_000 });
  if (size === "XL") return <RadarSection signals={radar.data?.items ?? []} totalCount={radar.data?.count ?? 0} loading={radar.isPending} error={radar.isError} onRetry={() => void radar.refetch()} />;
  if (!radar.data) return <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
  const items = sortSignals(radar.data.items);
  const urgent = items.filter(needsAttention);
  const excess = items.filter((s) => (s.impact ?? 0) > 0 && (s.type === "risk" || s.type === "deviation")).reduce((sum, s) => sum + (s.impact ?? 0), 0);
  const headline = urgent.length ? `${urgent.length} ${urgent.length === 1 ? "pede" : "pedem"} sua atenção` : "Tudo tranquilo";
  if (size === "S") return (
    <Tile title="Radar" className={className} testId="radar-insight">
      <p className={cn(NUMBER_TILE, urgent.length && "text-expense")}>{urgent.length || "0"}</p>
      <p className={cn(NOTE, "mt-auto line-clamp-2")}>{urgent.length ? `${urgent.length === 1 ? "pede" : "pedem"} atenção` : "nada pedindo atenção"} · {items.length} {items.length === 1 ? "sinal" : "sinais"}</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title={`${items.length} ${items.length === 1 ? "sinal ativo" : "sinais ativos"}`} className={className} testId="radar-insight">
      <p className="font-heading text-[clamp(1.2rem,7cqw,1.75rem)] font-bold leading-tight tracking-tight">{headline}</p>
      {excess > 0 ? <p className={cn(NOTE, "mt-auto")}>Somando, <b className="font-semibold text-expense">{formatBRL(excess)}</b> acima dos seus limites e padrões.</p> : urgent[0] ? <p className={cn(NOTE, "mt-auto line-clamp-2")}>{urgent[0].title}</p> : null}
    </Tile>
  );
  return (
    <InsightShell title="Radar" subtitle={`${headline} · ${items.length} ${items.length === 1 ? "sinal" : "sinais"}`} to={to} className={className} testId="radar-insight">
      <ul className="divide-y divide-border/70">
        {items.slice(0, 4).map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => navigate(radarTarget(s).to)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{s.title}</span><span className="block truncate text-[12px] text-muted-foreground">{s.description}</span></span>
              {s.metric ? <span className={cn("shrink-0 text-sm font-semibold tabular-nums", needsAttention(s) && "text-expense")}>{s.metric}</span> : null}
            </button>
          </li>
        ))}
        {!items.length ? <li className={cn(NOTE, "py-3")}>Tudo tranquilo no seu Radar por enquanto.</li> : null}
      </ul>
    </InsightShell>
  );
}

function CardsGate({ children }: { children: (cards: NonNullable<ReturnType<typeof useCards>["data"]>) => ReactNode }) {
  const cards = useCards();
  if (!cards.data) return <div className="h-full min-h-40 animate-pulse rounded-[24px] bg-muted" />;
  return <>{children(cards.data)}</>;
}

export function InsightWidget({ id, size, config = {}, slots, className }: { id: string; size: WidgetSize; config?: WidgetConfig; slots?: WidgetSlots; className?: string }) {
  const def = insightById(id);
  if (!def) return null;
  const custom = slots?.[id];
  if (custom) return <>{custom(size)}</>;
  // A tap on a widget (or its title) opens its analysis page; that page links to the filtered screen.
  const to = size === "XL" ? undefined : detailPath(id, config);
  const month = currentMonth();
  switch (id) {
    case "gastar-hoje": return <SpendTodayInsight size={size} to={to} className={className} />;
    case "previsao-saldo": return <BalanceForecastInsight size={size} to={to} className={className} />;
    case "semana-que-vem": return <WeekAheadInsight size={size} to={to} className={className} />;
    case "fatura-que-vem": return <NextInvoiceInsight size={size} to={to} className={className} />;
    case "contas-fixas": return <FixedBillsInsight size={size} to={to} {...monthRange(month)} flowLink={to} className={className} />;
    case "faturas": return <CardsGate>{(cards) => <InvoicesInsight size={size} to={to} cards={cards} cardId={config.cardId ?? null} className={className} />}</CardsGate>;
    case "parcelas": return <InstallmentsInsight size={size} to={to} cardId={config.cardId ?? null} className={className} />;
    case "orcamento": return <BudgetInsight size={size} to={to} className={className} />;
    case "metas": return <GoalsInsight size={size} to={to} className={className} />;
    case "categorias": return <CategoriesWidget size={size} to={to} className={className} />;
    case "radar": return <RadarWidget size={size} to={to} className={className} />;
    default: return null;
  }
}
