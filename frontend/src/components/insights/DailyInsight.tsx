/** Análise do dia: today's analysis from the library, drawn like the analysis itself with a small "do dia" mark. */
import { useEffect, useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { todayISO } from "@/lib/format";
import { dailyPick } from "@/lib/insights/daily";
import { DISCOVERY_NEEDS, DISCOVERY_SOURCES } from "@/lib/insights/discoveries";
import { useLayout } from "@/lib/insights/layout";
import { insightById, type WidgetSize } from "@/lib/insights/registry";
import { READERS } from "@/lib/insights/catalog";
import { cn } from "@/lib/utils";
import { CatalogInsight, useCatalogCtx } from "@/components/insights/CatalogInsight";
import { NOTE, Tile } from "@/components/insights/InsightShell";

const KEY = "finnos:analise-do-dia";

export function DailyInsight({ size, className }: { size: WidgetSize; className?: string }) {
  const today = todayISO();
  const home = useLayout("inicio"), board = useLayout("analise");
  const placed = useMemo(() => [...home, ...board].map((w) => w.id), [home, board]);
  // The day's analysis comes from the ones that work on recent months, like Descobertas: those that need every
  // lançamento ever (recorrentes escondidos, aumentos de preço, juros e tarifas) stay for when the person places them,
  // so opening Início never downloads the whole history just to choose one.
  const needs = useMemo(() => [...new Set([...DISCOVERY_NEEDS, ...DISCOVERY_SOURCES.flatMap((id) => READERS[id].needs)])], []);
  const historyOnly = useMemo(() => Object.keys(READERS).filter((rid) => READERS[rid].needs.includes("allTx")), []);
  const ctx = useCatalogCtx(needs);
  // One pick per day: kept once chosen, so the widget does not jump while the data loads.
  const id = useMemo(() => {
    try { const saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (saved?.date === today && saved.id && !placed.includes(saved.id) && !historyOnly.includes(saved.id)) return saved.id as string; } catch { /* storage unavailable */ }
    return ctx ? dailyPick(ctx, placed, today, historyOnly) : null;
  }, [ctx, placed, today, historyOnly]);
  useEffect(() => { if (id) { try { localStorage.setItem(KEY, JSON.stringify({ date: today, id })); } catch { /* storage unavailable */ } } }, [id, today]);

  if (!ctx && !id) return <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
  if (!id) return (
    <Tile title="Análise do dia" className={className} testId="daily-insight">
      <p className={cn(NOTE, "mt-auto")}>Todas as análises com algo a mostrar já estão no seu painel.</p>
    </Tile>
  );
  const def = insightById(id);
  return (
    <div className={cn("relative h-full", className)} data-testid="daily-insight" data-daily-id={id}>
      <CatalogInsight id={id} size={size === "XL" ? "XL" : size} className="h-full ring-1 ring-primary/30" />
      <span className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary" title={def ? `Hoje: ${def.title}` : undefined}>
        <CalendarDays className="size-3" aria-hidden="true" />Do dia
      </span>
    </div>
  );
}
