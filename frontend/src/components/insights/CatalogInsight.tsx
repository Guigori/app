/** Draws any analysis of the catalog (lib/insights/catalog.ts) in P/M/G and on its page, always with the Gráficos FINNOS. */
import { useQuery } from "@tanstack/react-query";
import { fetchBudget, fetchBudgetCycleProgress, fetchBudgetSuggestion, fetchCategories, fetchCurrentBudgetCycle, fetchDashboard, fetchFlow, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { addMonth, currentMonth, formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { monthRange } from "@/lib/insights/fixedBills";
import { READERS, type Chart, type Ctx, type Reading } from "@/lib/insights/catalog";
import { insightById, type WidgetSize } from "@/lib/insights/registry";
import { cn } from "@/lib/utils";
import { Bars, BulletBar, Donut, Gauge, ProjectionLine, SegmentedBar } from "@/components/charts/FinnosCharts";
import { FindingList, InsightShell, LABEL, NOTE, NUMBER_HERO, NUMBER_TILE, Tile } from "@/components/insights/InsightShell";
import { FinnSummary, VsLastMonth } from "@/components/insights/FinnSummary";
import { useAccounts, useBalanceHistory, useCards } from "@/components/insights/useInsightData";
import { useMemo, useState } from "react";

const stale = { staleTime: 60_000 };

/** Loads what the given analyses need (one shared cache with the rest of the library). */
export function useCatalogCtx(needList: string[]): Ctx | null {
  const needs = new Set(needList);
  const { hidden } = useBalanceHidden();
  const today = todayISO();
  const month = currentMonth();
  const prevMonth = addMonth(month, -1);
  const range = monthRange(month), prevRange = monthRange(prevMonth);
  const tx = useQuery({ queryKey: ["transactions", "month", range.start, range.end], queryFn: () => fetchTransactions({ start_date: range.start, end_date: range.end }), ...stale, enabled: needs.has("tx") });
  const prevTx = useQuery({ queryKey: ["transactions", "month", prevRange.start, prevRange.end], queryFn: () => fetchTransactions({ start_date: prevRange.start, end_date: prevRange.end }), ...stale, enabled: needs.has("prevTx") });
  const allTx = useQuery({ queryKey: ["transactions", "analysis-all"], queryFn: () => fetchTransactions({ start_date: "1900-01-01", end_date: "2999-12-31" }), ...stale, enabled: needs.has("allTx") });
  const dashboard = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month), ...stale, enabled: needs.has("dashboard") });
  const prevDashboard = useQuery({ queryKey: ["dashboard", prevMonth], queryFn: () => fetchDashboard(prevMonth), ...stale, enabled: needs.has("prevDashboard") });
  const subs = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions, ...stale, enabled: needs.has("subs") });
  const flow = useQuery({ queryKey: ["flow", "insights", month], queryFn: () => fetchFlow({ month, months: 6 }), ...stale, enabled: needs.has("flow") });
  const cards = useCards();
  const accounts = useAccounts();
  const prevHistory = useBalanceHistory(prevMonth);
  const history = useBalanceHistory(month);
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month), ...stale, enabled: needs.has("budget") });
  const cycle = useQuery({
    queryKey: ["budget-cycle-current-progress"], ...stale, enabled: needs.has("cycle"),
    queryFn: async () => { const c = await fetchCurrentBudgetCycle(); if (!c) return null; try { return { cycle: c, progress: await fetchBudgetCycleProgress(c.id) }; } catch { return { cycle: c, progress: null }; } },
  });
  const suggestion = useQuery({ queryKey: ["budget-suggestion"], queryFn: async () => { try { return await fetchBudgetSuggestion(); } catch { return null; } }, ...stale, enabled: needs.has("suggestion") });
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, ...stale, enabled: needs.has("categories") });
  const wait = (n: string, q: { data?: unknown; isError: boolean }) => needs.has(n as never) && q.data === undefined && !q.isError;
  const loading = wait("tx", tx) || wait("prevTx", prevTx) || wait("allTx", allTx) || wait("dashboard", dashboard) || wait("prevDashboard", prevDashboard) || wait("subs", subs) || wait("flow", flow) || wait("cards", cards) || wait("accounts", accounts) || wait("prevHistory", prevHistory) || wait("history", history) || wait("budget", budget) || wait("cycle", cycle) || wait("suggestion", suggestion) || wait("categories", categories);
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  // Same data → same object, so whoever reads it (Descobertas, avisos) does not recompute on every render.
  return useMemo(() => loading ? null : ({
    today, month, prevMonth, money: (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v)),
    tx: arr(tx.data), prevTx: arr(prevTx.data), allTx: arr(allTx.data),
    dashboard: dashboard.data ?? null, prevDashboard: prevDashboard.data ?? null, subs: subs.data ?? null,
    cards: arr(cards.data), accounts: arr(accounts.data), flow: flow.data ?? null, prevHistory: prevHistory.data ?? null,
    history: history.data ?? null, budget: budget.data ?? null, cycle: cycle.data ?? null, suggestion: suggestion.data ?? null, categories: arr(categories.data),
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }), [loading, hidden, today, month, tx.data, prevTx.data, allTx.data, dashboard.data, prevDashboard.data, subs.data, flow.data, cards.data, accounts.data, prevHistory.data, history.data, budget.data, cycle.data, suggestion.data, categories.data]);
}

export function ChartView({ chart, size, money }: { chart: Chart; size: WidgetSize; money: (v: number) => string }) {
  const small = size === "M";
  if (chart.type === "bars") return <Bars height={small ? 70 : 140} data={small ? chart.data.map((d) => ({ ...d, valueLabel: "" })) : chart.data} />;
  if (chart.type === "segmented") return <SegmentedBar format={money} total={chart.total} height={10} segments={chart.segments} />;
  if (chart.type === "gauge") return <Gauge percent={chart.percent} goal={chart.goal} size={small ? 104 : 140} detail={chart.detail}><span className="text-sm font-semibold tabular-nums">{chart.center}</span></Gauge>;
  if (chart.type === "line") return <ProjectionLine points={chart.points} area labels={false} height={small ? 48 : 90} format={money} />;
  if (chart.type === "bullets") return (
    <ul className={small ? "space-y-2.5" : "space-y-4"}>
      {chart.items.slice(0, small ? 2 : 8).map((b) => (
        <li key={b.label}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="min-w-0 truncate font-medium">{b.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{b.note ?? `${money(b.value)} / ${money(b.limit)}`}</span></div>
          <BulletBar className="mt-1.5" value={b.value} limit={b.limit} format={money} />
        </li>
      ))}
    </ul>
  );
  return <DonutView chart={chart} size={size} money={money} />;
}

function DonutView({ chart, size, money }: { chart: Extract<Chart, { type: "donut" }>; size: WidgetSize; money: (v: number) => string }) {
  const [picked, setPicked] = useState<string | null>(null);
  return <Donut slices={chart.slices} size={size === "M" ? 92 : 156} selectedId={picked} onSelect={setPicked} centerLabel={chart.center} format={money} />;
}

const toneClass = (t?: "income" | "expense") => (t === "income" ? "text-income" : t === "expense" ? "text-expense" : "");

export function CatalogInsight({ id, size, to, className }: { id: string; size: WidgetSize; to?: string; className?: string }) {
  const ctx = useCatalogCtx(READERS[id]?.needs ?? []);
  const def = insightById(id);
  const { hidden } = useBalanceHidden();
  if (!ctx || !READERS[id]) return <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
  let r: Reading;
  try { r = READERS[id].read(ctx); } catch { return <Tile title={def?.title ?? "Análise"} className={className}><p className={NOTE}>Não deu para ler esta análise agora.</p></Tile>; }
  const fmt = (kind: "money" | "count" | "points") => (kind === "money" ? ctx.money : kind === "points" ? (v: number) => `${Math.round(v)} p.p.` : (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
  const vs = r.vs ? <VsLastMonth c={r.vs.c} label={r.vs.label} format={fmt(r.vs.format)} /> : null;
  const testId = `catalog-${id}`;
  if (r.empty && size !== "XL") return (
    <Tile title={def?.title ?? r.tile} className={className} testId={testId}>
      <p className={cn(NOTE, "mt-auto")}>{r.empty}</p>
    </Tile>
  );
  if (size === "S") return (
    <Tile title={r.tile} className={className} testId={testId}>
      <p className={cn(NUMBER_TILE, "truncate", toneClass(r.tone))}>{r.value}</p>
      <p className={cn(NOTE, "mt-auto line-clamp-2")}>{r.note}</p>
    </Tile>
  );
  const side = r.chart && (r.chart.type === "gauge" || r.chart.type === "donut");
  if (size === "M") return (
    <Tile title={def?.title ?? r.tile} className={className} testId={testId}>
      <div className={cn("flex min-h-0 flex-1 gap-4", side ? "items-center" : "flex-col")}>
        <div className="min-w-0 flex-1">
          <p className={cn(NUMBER_TILE, "truncate", toneClass(r.tone))}>{r.value}</p>
          <p className={cn(NOTE, "mt-1 truncate")}>{r.note}</p>
          {vs ? <div className="mt-1 truncate">{vs}</div> : null}
        </div>
        {r.chart && !hidden ? <div className={side ? "shrink-0" : "mt-auto"}><ChartView chart={r.chart} size="M" money={ctx.money} /></div> : null}
      </div>
    </Tile>
  );
  const rows = r.rows ?? [];
  return (
    <>{size === "XL" ? <FinnSummary title={def?.title ?? r.tile} sentences={r.empty ? [r.empty] : r.summary} context={r.context} /> : null}
    <InsightShell title={def?.title ?? r.tile} subtitle={r.subtitle} to={to} className={className} testId={testId}>
      {r.empty ? <p className={NOTE}>{r.empty}</p> : (
        <>
          <div className={cn("flex gap-4", side ? "items-end justify-between" : "flex-col")}>
            <div className="min-w-0">
              <p className={LABEL}>{r.tile}</p>
              <p className={cn(NUMBER_HERO, "mt-2 break-words", toneClass(r.tone))}>{r.value}</p>
              <p className={cn(NOTE, "mt-2")}>{r.note}</p>
              {vs ? <div className="mt-1">{vs}</div> : null}
            </div>
            {r.chart && side && !hidden ? <ChartView chart={r.chart} size={size} money={ctx.money} /> : null}
          </div>
          {r.chart && !side && !hidden ? <div className="mt-5"><ChartView chart={r.chart} size={size} money={ctx.money} /></div> : null}
          {rows.length ? (
            <ul className="mt-5 divide-y divide-border/60">
              {rows.slice(0, size === "XL" ? 30 : 4).map((row, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-2.5 text-sm first:pt-0">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">{row.color ? <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} /> : null}<span className="truncate font-medium">{row.label}</span></span>
                    {row.sub ? <span className={cn("block truncate text-[12px] text-muted-foreground", row.color && "pl-4")}>{row.sub}</span> : null}
                  </span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", toneClass(row.tone))}>{row.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {r.findings.length ? <div className="mt-auto pt-4"><FindingList findings={size === "XL" ? r.findings : r.findings.slice(0, 1)} /></div> : null}
        </>
      )}
    </InsightShell></>
  );
}
