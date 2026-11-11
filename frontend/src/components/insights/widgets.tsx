/** Draws any analysis of the library in a given size; the board and the gallery use this one entry point. */
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard, fetchRadar } from "@/lib/data";
import { currentMonth } from "@/lib/format";
import { monthRange } from "@/lib/insights/fixedBills";
import { insightById, type WidgetConfig, type WidgetSize } from "@/lib/insights/registry";
import { ExpensesDonutChart } from "@/components/dashboard/ExpensesDonutChart";
import { RadarSection } from "@/components/dashboard/RadarSection";
import { FixedBillsInsight } from "@/components/insights/FixedBillsInsight";
import { InstallmentsInsight } from "@/components/insights/InstallmentsInsight";
import { InvoicesInsight } from "@/components/insights/InvoicesInsight";
import { BalanceForecastInsight, NextInvoiceInsight, SpendTodayInsight, WeekAheadInsight } from "@/components/insights/StarInsights";
import { useCards } from "@/components/insights/useInsightData";

/** A screen can draw one analysis its own way (Início keeps its interactive donut). */
export type WidgetSlots = Partial<Record<string, (size: WidgetSize) => ReactNode>>;

function CategoriesWidget({ className }: { className?: string }) {
  const navigate = useNavigate();
  const month = currentMonth();
  const dashboard = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month), staleTime: 60_000 });
  if (!dashboard.data) return <div className="min-h-[22rem] animate-pulse rounded-[24px] bg-muted" />;
  return <ExpensesDonutChart className={className} month={dashboard.data.month} slices={dashboard.data.categories} total={dashboard.data.expense}
    onOpenCategory={(slice) => navigate(`/transacoes?month=${month}&metric=despesas&category_id=${encodeURIComponent(slice.category_id ?? "")}`)} />;
}

function RadarWidget() {
  const radar = useQuery({ queryKey: ["radar", currentMonth()], queryFn: fetchRadar, staleTime: 60_000 });
  return <RadarSection signals={radar.data?.items ?? []} totalCount={radar.data?.count ?? 0} loading={radar.isPending} error={radar.isError} onRetry={() => void radar.refetch()} />;
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
  const to = def.to(config);
  const month = currentMonth();
  switch (id) {
    case "gastar-hoje": return <SpendTodayInsight size={size} to={to} className={className} />;
    case "previsao-saldo": return <BalanceForecastInsight size={size} to={to} className={className} />;
    case "semana-que-vem": return <WeekAheadInsight size={size} to={to} className={className} />;
    case "fatura-que-vem": return <NextInvoiceInsight size={size} to={to} className={className} />;
    case "contas-fixas": return <FixedBillsInsight size={size} to={to} {...monthRange(month)} flowLink={to} className={className} />;
    case "faturas": return <CardsGate>{(cards) => <InvoicesInsight size={size} to={to} cards={cards} cardId={config.cardId ?? null} className={className} />}</CardsGate>;
    case "parcelas": return <InstallmentsInsight size={size} to={to} cardId={config.cardId ?? null} className={className} />;
    case "categorias": return <CategoriesWidget className={className} />;
    case "radar": return <RadarWidget />;
    default: return null;
  }
}
